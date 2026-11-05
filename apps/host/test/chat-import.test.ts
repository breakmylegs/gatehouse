// CH-04 (owner's Chat build): a claude.ai export imported into Chat's store, read only, redacted, and never half done.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { redact } from "@gatehouse/policy"
import Fastify from "fastify"
import { registerChatRoutes } from "../src/chat/api.js"
import { ChatStore } from "../src/chat/db.js"
import { ChatRecorder } from "../src/chat/recorder.js"
import { ImportError, importExport } from "../src/chat/import/importer.js"
import { ZipRefused } from "../src/chat/import/zip.js"
import {
  conversation,
  manifestLayout,
  perProjectLayout,
  singleLayout,
} from "./fixtures/chat-export.js"
import { makeZip } from "./fixtures/zip-fixture.js"

let dir: string | undefined
const stores: ChatStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})
function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-chatimport-"))
  const store = new ChatStore({
    file: path.join(dir, "chat.db"),
    redact: (v) => redact(v, { terms: ["Project Falcon"] }),
  })
  stores.push(store)
  let n = 0
  const run = (zip: Buffer) => {
    const file = path.join(dir!, `export-${n++}.zip`)
    fs.writeFileSync(file, zip)
    return importExport({ file, store, tmpDir: dir! })
  }
  return { store, run }
}
const shown = (store: ChatStore, id: string) =>
  store.branch(id).map((s) => {
    const t = s.message.blocks.find((b) => b.type === "text") as { text: string } | undefined
    return `${t?.text} ${s.index + 1}/${s.siblings.length}`
  })

describe("importing a claude.ai export", () => {
  it("imports every layout, with the shown branch, attachments, and instructions and memory waiting to be accepted", async () => {
    for (const [zip, layout, memories] of [
      [singleLayout(), "single", 0],
      [perProjectLayout(), "per-project", 2],
      [manifestLayout(), "manifest", 2],
    ] as const) {
      const { store, run } = setup()
      const r = await run(zip)
      expect(r.layout, layout).toBe(layout)
      expect(r.zipSha256).toMatch(/^[0-9a-f]{64}$/)
      const convs = store.listConversations({ kind: "imported" })
      expect(convs.length, layout).toBeGreaterThan(0)
      const c = convs.find((x) => x.title === "Conversation 1")!
      expect(c.provenance).toMatchObject({
        kind: "imported",
        source: "claude.ai",
        importBatchId: r.batchId,
      })
      // The newest answer at the fork is the one shown, and the other is its sibling.
      expect(shown(store, c.id)).toEqual(["Question 1 1/1", "Second answer 1 2/2"])
      const pending = store.pendingImports()
      expect(pending.projects).toEqual([
        expect.objectContaining({
          name: "Design notes",
          instructions: "Use UK English. Prefer short declarative sentences.",
        }),
      ])
      expect(pending.memories, layout).toHaveLength(memories)
      // Read only: nothing can be added to an imported conversation.
      expect(() => store.addMessage(c.id, { parentId: null, role: "user", blocks: [] })).toThrow(
        /read-only/,
      )
      expect(store.search("Question").length, layout).toBeGreaterThan(0)
      stores.splice(0).forEach((s) => s.close())
      fs.rmSync(dir!, { recursive: true, force: true })
      dir = undefined
    }
  })

  it("changes nothing when the same export is imported again, and takes a newer conversation in place of the old", async () => {
    const { store, run } = setup()
    const first = await run(singleLayout())
    expect(first.counts).toMatchObject({ imported: 3, updated: 0, skipped: 0 })
    const id = store
      .listConversations({ kind: "imported" })
      .find((c) => c.title === "Conversation 1")!.id
    const again = await run(singleLayout())
    expect(again.counts).toMatchObject({ imported: 0, updated: 0, skipped: 3 })
    expect(store.listConversations({ kind: "imported" })).toHaveLength(2)
    const newer = await run(
      singleLayout([conversation(1, { updated: "2026-11-01T10:00:00.000000Z" }), conversation(2)]),
    )
    expect(newer.counts).toMatchObject({ imported: 0, updated: 1, skipped: 2 })
    // The same conversation, its snapshot replaced; nothing doubled.
    expect(
      store.listConversations({ kind: "imported" }).find((c) => c.title === "Conversation 1")!.id,
    ).toBe(id)
    expect(store.messages(id)).toHaveLength(3)
  })

  it("redacts before storing, and counts it", async () => {
    const { store, run } = setup()
    const r = await run(singleLayout([conversation(1, { secret: "about Project Falcon" })]))
    expect(r.counts.redacted).toBeGreaterThan(0)
    const id = store.listConversations({ kind: "imported" })[0]!.id
    expect(JSON.stringify(store.messages(id))).not.toContain("Project Falcon")
    expect(store.search("Falcon")).toEqual([])
  })

  it("leaves nothing behind when the export is damaged or an attack", async () => {
    const { store, run } = setup()
    const cut = JSON.stringify([conversation(1), conversation(2)]).slice(0, -40)
    await expect(run(makeZip([{ name: "conversations.json", data: cut }]))).rejects.toThrow(
      /cut short|not valid/,
    )
    await expect(
      run(
        makeZip([
          { name: "conversations.json", data: "[]" },
          { name: "../../evil.json", data: "{}" },
        ]),
      ),
    ).rejects.toBeInstanceOf(ZipRefused)
    await expect(
      run(makeZip([{ name: "bomb.json", data: Buffer.alloc(20 * 1024 * 1024) }])),
    ).rejects.toBeInstanceOf(ZipRefused)
    expect(store.listConversations()).toEqual([])
    expect(store.pendingImports()).toEqual({ projects: [], memories: [] })
    // Nothing of the work folder is left either.
    expect(fs.readdirSync(dir!).filter((f) => f.startsWith("codeh-import-"))).toEqual([])
  })

  it("says what it found when the export is not one Codehouse knows", async () => {
    const { run } = setup()
    const r = run(
      makeZip([
        { name: "photos/cat.jpg", data: "x" },
        { name: "notes.json", data: '{"hello":1}' },
      ]),
    )
    await expect(r).rejects.toBeInstanceOf(ImportError)
    await expect(r).rejects.toMatchObject({ files: ["photos/cat.jpg", "notes.json"] })
  })

  it("serves an imported conversation as shown, with its attachments, and switches its branch (CH-05)", async () => {
    const { store, run } = setup()
    await run(singleLayout())
    const app = Fastify()
    registerChatRoutes(app, {
      store,
      recorder: new ChatRecorder(
        store,
        () => undefined,
        () => undefined,
      ),
    })
    const c = store
      .listConversations({ kind: "imported" })
      .find((x) => x.title === "Conversation 1")!
    const got = (await app.inject({ url: `/api/chat/conversation?id=${c.id}` })).json() as {
      steps: Array<{ message: { id: string; role: string }; index: number; siblings: string[] }>
      attachments: Record<string, Array<{ fileName: string; included: boolean }>>
    }
    expect(got.steps.map((s) => [s.message.role, s.index, s.siblings.length])).toEqual([
      ["user", 0, 1],
      ["assistant", 1, 2],
    ])
    expect(got.attachments[got.steps[0]!.message.id]).toEqual([
      expect.objectContaining({ fileName: "notes.md", included: true }),
      expect.objectContaining({ fileName: "diagram.png", included: false }),
    ])
    const first = got.steps[1]!.siblings[0]!
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/chat/conversation/switch",
          payload: { id: c.id, messageId: first },
        })
      ).statusCode,
    ).toBe(200)
    expect(shown(store, c.id)).toEqual(["Question 1 1/1", "First answer 1 1/2"])
    expect((await app.inject({ url: "/api/chat/conversation?id=nothing" })).statusCode).toBe(404)
    await app.close()
  })

  it("uses an imported project's instructions and memory only once you accept each one", async () => {
    const { store, run } = setup()
    await run(perProjectLayout())
    const { projects, memories } = store.pendingImports()
    expect(store.accept("project", projects[0]!.id)).toBe(true)
    expect(store.accept("memory", memories[0]!.id)).toBe(true)
    expect(store.dismissMemory(memories[1]!.id)).toBe(true)
    expect(store.pendingImports()).toEqual({ projects: [], memories: [] })
    // Accepted entries are not offered again, and importing again adds no copies.
    await run(perProjectLayout())
    expect(store.pendingImports().memories).toHaveLength(1)
  })
})
