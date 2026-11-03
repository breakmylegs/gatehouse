// What chats remember (owner's plan, W1-08, ADR 0006): kept by topic, redacted, written atomically, read tolerantly.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { MAX_ENTRIES, MAX_PROMPT_CHARS, MAX_TEXT, MemoryError, MemoryStore } from "../src/memory.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-memory-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const fresh = (redact?: (t: string) => string) =>
  new MemoryStore(path.join(dir, `m-${++n}`), redact)
const folder = () => path.join(dir, `m-${n}`)
const G = { kind: "global" } as const
const P = (name: string) => ({ kind: "project", name }) as const
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch (e) {
    return e instanceof MemoryError ? e.code : "other"
  }
  return "none"
}

describe("keeping a memory", () => {
  it("keeps entries by topic for everyone and for a project, with who made them", async () => {
    const m = fresh()
    const a = await m.add(G, "Units", "Prefers metric.", "claude")
    await m.add(P("Home"), "Garden", "Beds are raised.", "you")
    expect(m.list(G)).toEqual([
      expect.objectContaining({ id: a.id, topic: "Units", text: "Prefers metric.", by: "claude" }),
    ])
    expect(m.list(P("Home"))[0]).toMatchObject({ topic: "Garden", by: "you" })
    expect(m.list(P("Other"))).toEqual([])
    expect(m.projects()).toEqual(["Home"])
  })

  it("redacts before it writes, so a secret never reaches the file", async () => {
    const m = fresh((t) => t.replaceAll("AcmeCorp", "[redacted]"))
    await m.add(G, "Work at AcmeCorp", "Works at AcmeCorp on billing.", "claude")
    expect(fs.readFileSync(path.join(folder(), "global.json"), "utf8")).not.toContain("AcmeCorp")
    expect(m.list(G)[0]).toMatchObject({
      topic: "Work at [redacted]",
      text: "Works at [redacted] on billing.",
    })
  })

  it("refuses an empty or oversized topic or text, a full list and a bad project name, and writes nothing", async () => {
    const m = fresh()
    expect(await code(() => m.add(G, "", "x", "claude"))).toBe("invalid")
    expect(await code(() => m.add(G, "t".repeat(61), "x", "claude"))).toBe("invalid")
    expect(await code(() => m.add(G, "t", "  ", "claude"))).toBe("invalid")
    expect(await code(() => m.add(G, "t", "x".repeat(MAX_TEXT + 1), "claude"))).toBe("invalid")
    expect(await code(() => m.add(P("../escape"), "t", "x", "claude"))).toBe("invalid")
    expect(m.list(G)).toEqual([])
    for (let i = 0; i < MAX_ENTRIES; i++) await m.add(G, "t", `entry ${i}`, "claude")
    expect(await code(() => m.add(G, "t", "one too many", "claude"))).toBe("full")
  })

  it("writes atomically: no temporary file is left behind", async () => {
    const m = fresh()
    await m.add(G, "t", "x", "claude")
    await m.add(P("Home"), "t", "y", "claude")
    expect(fs.readdirSync(folder()).sort()).toEqual(["global.json", "projects"])
    expect(fs.readdirSync(path.join(folder(), "projects"))).toEqual(["Home.json"])
  })
})

describe("reading tolerantly", () => {
  it("treats a missing or damaged file as empty and skips an entry it cannot read", () => {
    const m = fresh()
    expect(m.list(G)).toEqual([])
    fs.mkdirSync(folder(), { recursive: true })
    fs.writeFileSync(path.join(folder(), "global.json"), "{ not json")
    expect(m.list(G)).toEqual([])
    fs.writeFileSync(
      path.join(folder(), "global.json"),
      JSON.stringify({
        version: 9,
        entries: [
          { id: "a1", topic: "t", text: "kept", at: "2026-01-01T00:00:00Z", by: "you", future: 1 },
          { id: 5 },
          "x",
          null,
        ],
      }),
    )
    expect(m.list(G).map((e) => e.id)).toEqual(["a1"])
  })

  it("keeps what a newer version wrote beside an entry, and the entries it cannot read, when one changes", async () => {
    const m = fresh()
    fs.mkdirSync(folder(), { recursive: true })
    fs.writeFileSync(
      path.join(folder(), "global.json"),
      JSON.stringify({
        entries: [
          {
            id: "a1",
            topic: "t",
            text: "old",
            at: "2026-01-01T00:00:00Z",
            by: "you",
            future: { keep: true },
          },
          { id: "z9", mystery: 1 },
        ],
      }),
    )
    await m.update("a1", { text: "new" })
    const saved = JSON.parse(fs.readFileSync(path.join(folder(), "global.json"), "utf8")).entries
    expect(saved[0]).toMatchObject({ id: "a1", text: "new", future: { keep: true } })
    expect(saved[1]).toEqual({ id: "z9", mystery: 1 })
  })
})

describe("changing and forgetting", () => {
  it("edits and removes an entry by id, wherever it is, and says when there is none", async () => {
    const m = fresh()
    const a = await m.add(G, "Units", "metric", "claude")
    const b = await m.add(P("Home"), "Garden", "raised", "claude")
    expect((await m.update(b.id, { topic: "Beds", text: "raised, south side" })).text).toBe(
      "raised, south side",
    )
    expect(m.list(P("Home"))[0]).toMatchObject({ topic: "Beds", text: "raised, south side" })
    // A change, or Still true, counts as checking it: its age starts again (B24).
    expect(Date.now() - Date.parse(m.list(P("Home"))[0]!.at)).toBeLessThan(60_000)
    expect(await code(() => m.update(a.id, { text: "" }))).toBe("invalid")
    expect((await m.remove(a.id)).topic).toBe("Units")
    expect(m.list(G)).toEqual([])
    expect(await code(() => m.remove(a.id))).toBe("missing")
    expect(await code(() => m.update("nope", { text: "x" }))).toBe("missing")
  })
})

describe("what a chat is given at its start", () => {
  it("is everyone's and its project's, newest first, and never another project's", async () => {
    const m = fresh()
    await m.add(G, "old", "first", "claude")
    await new Promise((r) => setTimeout(r, 5))
    await m.add(P("Home"), "mid", "second", "claude")
    await m.add(P("Other"), "no", "not this one", "claude")
    await new Promise((r) => setTimeout(r, 5))
    await m.add(G, "new", "third", "claude")
    expect(m.forChat("Home").map((e) => e.topic)).toEqual(["new", "mid", "old"])
    expect(m.forChat().map((e) => e.topic)).toEqual(["new", "old"])
  })

  it("stops at the size limit, keeping the newest", async () => {
    const m = fresh()
    for (let i = 0; i < 20; i++) {
      await m.add(G, `topic ${i}`, "x".repeat(900), "claude")
      await new Promise((r) => setTimeout(r, 2))
    }
    const used = m.forChat()
    expect(used.reduce((s, e) => s + e.topic.length + e.text.length, 0)).toBeLessThanOrEqual(
      MAX_PROMPT_CHARS,
    )
    expect(used.length).toBeGreaterThan(0)
    expect(used.length).toBeLessThan(20)
    expect(used[0]!.topic).toBe("topic 19")
  })
})

describe("export and import as Markdown", () => {
  it("brings back what was exported, in another place, and skips what is already there", async () => {
    const a = fresh()
    await a.add(G, "Units", "Prefers metric.", "claude")
    await a.add(P("Home"), "Garden", "Beds are raised.", "claude")
    const md = a.exportMarkdown()
    expect(md).toContain("## Global")
    expect(md).toContain("## Project: Home")
    expect(md).toContain("- [Units] Prefers metric.")
    const b = fresh()
    expect(await b.importMarkdown(md)).toEqual({ added: 2, skipped: 0 })
    expect(b.list(G)[0]).toMatchObject({ topic: "Units", text: "Prefers metric.", by: "you" })
    expect(b.list(P("Home"))[0]).toMatchObject({ topic: "Garden" })
    expect(await b.importMarkdown(md)).toEqual({ added: 0, skipped: 2 })
  })

  it("ignores lines that are not entries, and redacts what it brings in", async () => {
    const m = fresh((t) => t.replaceAll("AcmeCorp", "[redacted]"))
    const r = await m.importMarkdown(
      [
        "# Codehouse memory",
        "",
        "- [lost] no heading yet",
        "## Global",
        "",
        "just words",
        "- [Work] At AcmeCorp.",
        "## Elsewhere",
        "- [x] unknown scope",
      ].join("\n"),
    )
    expect(r.added).toBe(1)
    expect(m.list(G)[0]!.text).toBe("At [redacted].")
  })
})
