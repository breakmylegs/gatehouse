// CH-02 (owner's Chat build, 4 Nov): Chat's own store, with messages as a tree.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { redact } from "@gatehouse/policy"
import { ChatStore, ChatStoreError, ftsQuery } from "../src/chat/db.js"
import { MIGRATIONS, migrate, schemaVersion } from "../src/chat/migrations.js"

let dir: string | undefined
const stores: ChatStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})
const root = () => (dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "gh-chat-")))
const open = (file = path.join(root(), "chat", "chat.db")) => {
  const s = new ChatStore({ file, redact: (v) => redact(v, { terms: ["Project Falcon"] }) })
  stores.push(s)
  return s
}
const text = (t: string) => [{ type: "text" as const, text: t }]

describe("Chat storage", () => {
  it("makes its file and tables in an empty data folder", () => {
    const s = open()
    expect(s.version).toBe(MIGRATIONS.length)
    expect(fs.existsSync(path.join(root(), "chat", "chat.db"))).toBe(true)
  })

  it("brings an older file up to date keeping what it held, and an older version still reads a newer file", () => {
    const file = path.join(root(), "chat", "chat.db")
    const s = open(file)
    const c = s.createConversation({ title: "Before", provenance: { kind: "native" } })
    s.addMessage(c.id, { parentId: null, role: "user", blocks: text("kept") })
    s.close()
    stores.length = 0
    const db = new DatabaseSync(file)
    const later = [...MIGRATIONS, "ALTER TABLE conversation ADD COLUMN colour TEXT"]
    expect(migrate(db, later)).toBe(MIGRATIONS.length + 1)
    expect(migrate(db, later)).toBe(MIGRATIONS.length + 1)
    db.close()
    const again = open(file)
    expect(again.messages(c.id).map((m) => m.blocks)).toEqual([text("kept")])
  })

  it("leaves the file as it was when a migration fails", () => {
    const db = new DatabaseSync(path.join(root(), "broken.db"))
    expect(() => migrate(db, ["CREATE TABLE a (x)", "CREATE TABLE b (y); NOT SQL"])).toThrow(
      /migration 2 failed/,
    )
    expect(schemaVersion(db)).toBe(1)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined()
    db.close()
  })

  it("shows the active branch with every sibling at each fork, and switches branches", () => {
    const s = open()
    const c = s.createConversation({ title: "Branches", provenance: { kind: "native" } })
    const ask = s.addMessage(c.id, { parentId: null, role: "user", blocks: text("Name a colour") })
    const red = s.addMessage(c.id, { parentId: ask.id, role: "assistant", blocks: text("Red") })
    const blue = s.addMessage(c.id, { parentId: ask.id, role: "assistant", blocks: text("Blue") })
    const more = s.addMessage(c.id, { parentId: blue.id, role: "user", blocks: text("Another") })
    const green = s.addMessage(c.id, {
      parentId: more.id,
      role: "assistant",
      blocks: text("Green"),
    })
    const steps = (b: ReturnType<ChatStore["branch"]>) =>
      b.map(
        (x) =>
          `${(x.message.blocks[0] as { text: string }).text} ${x.index + 1}/${x.siblings.length}`,
      )
    expect(steps(s.branch(c.id))).toEqual([
      "Name a colour 1/1",
      "Blue 2/2",
      "Another 1/1",
      "Green 1/1",
    ])
    expect(s.switchTo(c.id, red.id)).toBe(red.id)
    expect(steps(s.branch(c.id))).toEqual(["Name a colour 1/1", "Red 1/2"])
    expect(s.switchTo(c.id, blue.id)).toBe(green.id)
    const yellow = s.addMessage(c.id, {
      parentId: more.id,
      role: "assistant",
      blocks: text("Yellow"),
    })
    expect(steps(s.branch(c.id))).toEqual([
      "Name a colour 1/1",
      "Blue 2/2",
      "Another 1/1",
      "Yellow 2/2",
    ])
    expect(s.conversation(c.id)?.activeLeaf).toBe(yellow.id)
    // Going back to Blue follows the newest answer at each fork below it.
    s.switchTo(c.id, red.id)
    expect(s.switchTo(c.id, blue.id)).toBe(yellow.id)
    expect(() => s.switchTo(c.id, "not-a-message")).toThrow(ChatStoreError)
  })

  it("keeps a message in its own conversation", () => {
    const s = open()
    const a = s.createConversation({ provenance: { kind: "native" } })
    const b = s.createConversation({ provenance: { kind: "native" } })
    const m = s.addMessage(a.id, { parentId: null, role: "user", blocks: text("hello") })
    expect(() =>
      s.addMessage(b.id, { parentId: m.id, role: "assistant", blocks: text("x") }),
    ).toThrow(/not in this conversation/)
  })

  it("redacts before storing, and counts what it changed", () => {
    const s = open()
    const c = s.createConversation({
      title: "About Project Falcon",
      provenance: { kind: "native" },
    })
    const m = s.addMessage(c.id, {
      parentId: null,
      role: "user",
      blocks: [
        {
          type: "text",
          text: "Project Falcon key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
        },
        { type: "text", text: "nothing secret" },
      ],
    })
    const stored = JSON.stringify(s.messages(c.id))
    expect(stored).not.toContain("Project Falcon")
    expect(stored).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789")
    expect(s.conversation(c.id)?.title).not.toContain("Project Falcon")
    expect(m.redactions).toBe(1)
    expect(s.search("Falcon")).toEqual([])
  })

  it("keeps an imported conversation read only, and records where each came from", () => {
    const s = open()
    const imported = s.createConversation({
      title: "From claude.ai",
      provenance: {
        kind: "imported",
        source: "claude.ai",
        sourceUuid: "0b1e",
        exportDate: "2026-11-01",
        importBatchId: "b1",
      },
    })
    expect(() =>
      s.addMessage(imported.id, { parentId: null, role: "user", blocks: text("more") }),
    ).toThrow(/read-only copy/)
    s.rename(imported.id, "Renamed")
    expect(s.conversation(imported.id)?.title).toBe("From claude.ai")
    const fork = s.createConversation({
      provenance: { kind: "fork", fromConversation: imported.id, fromMessage: "m1" },
    })
    expect(s.conversation(fork.id)).toMatchObject({
      kind: "fork",
      provenance: { fromConversation: imported.id },
    })
    expect(s.listConversations({ kind: "imported" }).map((c) => c.id)).toEqual([imported.id])
  })

  it("finds messages by their words, never reading what you type as search syntax", () => {
    const s = open()
    const c = s.createConversation({ title: "Recipes", provenance: { kind: "native" } })
    s.addMessage(c.id, {
      parentId: null,
      role: "user",
      blocks: text("How long to bake sourdough bread?"),
    })
    s.addMessage(c.id, {
      parentId: null,
      role: "assistant",
      blocks: [{ type: "thinking", text: "secretthought" }, ...text("About forty minutes.")],
    })
    expect(s.search("sourdough").map((h) => h.title)).toEqual(["Recipes"])
    expect(s.search("sourdough")[0]?.snippet).toContain("[sourdough]")
    expect(s.search("secretthought")).toEqual([])
    expect(s.search('bread" OR "x')).toEqual([])
    expect(() => s.search("NEAR( * ^ :")).not.toThrow()
    expect(ftsQuery('a "b"')).toBe('"a" """b"""')
    s.delete(c.id)
    expect(s.search("sourdough")).toEqual([])
    expect(s.messages(c.id)).toEqual([])
  })
})
