import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { SessionHistory, type SessionSdk } from "../src/history.js"
import { SessionMetaStore } from "../src/session-meta.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-history-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const file = () => path.join(dir, `sessions-${n++}.json`)

const said = (role: "user" | "assistant", text: string, sub: string | null = null) => ({
  type: role,
  message: { role, content: [{ type: "text", text }] },
  parent_tool_use_id: sub,
})

function fakeSdk(): SessionSdk & { renamed: Array<[string, string, string | undefined]> } {
  const renamed: Array<[string, string, string | undefined]> = []
  return {
    renamed,
    listSessions: async () => [
      { sessionId: "a", summary: "Fix the login page", lastModified: 3, cwd: "C:/dev/shop" },
      {
        sessionId: "b",
        summary: "Excel clone",
        lastModified: 2,
        cwd: "C:/dev/sheet",
        customTitle: "Minisheet",
      },
      { sessionId: "c", summary: "Old thing", lastModified: 1, cwd: "C:/dev/old" },
    ],
    getSessionMessages: async (id) =>
      id === "a"
        ? [
            said("user", "The login button does nothing"),
            said("assistant", "The handler is never bound."),
          ]
        : id === "b"
          ? [said("user", "Make the grid editable"), said("assistant", "Done", "task-1")]
          : [said("user", "the login form again")],
    renameSession: async (id, title, o) => {
      renamed.push([id, title, o?.dir])
    },
  }
}

describe("your titles, pins and archives", () => {
  it("are kept on disk, and read back by a new store", async () => {
    const f = file()
    const a = new SessionMetaStore(f)
    await a.set("s1", { title: "  Login fix  ", pinned: true })
    await a.set("s2", { archived: true })
    const b = new SessionMetaStore(f)
    expect(b.get("s1")).toEqual({ title: "Login fix", pinned: true })
    expect(b.get("s2")).toEqual({ archived: true })
    await b.set("s1", { title: null, pinned: false })
    expect(new SessionMetaStore(f).get("s1")).toEqual({})
  })

  it("keep what a newer version wrote, and start empty from a broken file", async () => {
    const f = file()
    fs.writeFileSync(
      f,
      JSON.stringify({ version: 1, sessions: { s1: { title: "x", colour: "blue" } } }),
    )
    const store = new SessionMetaStore(f)
    await store.set("s1", { pinned: true })
    const raw = JSON.parse(fs.readFileSync(f, "utf8")) as {
      sessions: Record<string, Record<string, unknown>>
    }
    expect(raw.sessions.s1).toMatchObject({ title: "x", colour: "blue", pinned: true })
    const broken = file()
    fs.writeFileSync(broken, "{ not json")
    expect(new SessionMetaStore(broken).get("s1")).toEqual({})
  })
})

describe("past sessions", () => {
  it("are listed with your title first, then the one Claude Code keeps", async () => {
    const meta = new SessionMetaStore(file())
    await meta.set("c", { title: "Mine" })
    const h = new SessionHistory(fakeSdk(), meta)
    expect((await h.list()).map((s) => s.title)).toEqual([
      "Fix the login page",
      "Minisheet",
      "Mine",
    ])
  })

  it("are searched in what was said, not in a subagent's work, and never the archived", async () => {
    const meta = new SessionMetaStore(file())
    await meta.set("c", { archived: true })
    const h = new SessionHistory(fakeSdk(), meta)
    const r = await h.search("login")
    expect(r.complete).toBe(true)
    expect(r.hits.map((x) => x.sessionId)).toEqual(["a"])
    expect(r.hits[0]?.snippets.join(" ")).toMatch(/login button does nothing/i)
    expect((await h.search("Done")).hits).toEqual([])
    expect((await h.search("x")).hits).toEqual([])
  })

  it("stops a long search and says it is incomplete", async () => {
    let t = 0
    const h = new SessionHistory(fakeSdk(), new SessionMetaStore(file()), () => (t += 30_000))
    expect((await h.search("login")).complete).toBe(false)
  })

  it("write a new title into the session's own transcript too, and keep it if that fails", async () => {
    const sdk = fakeSdk()
    const h = new SessionHistory(sdk, new SessionMetaStore(file()))
    await h.setMeta("a", { title: "Login fix" }, "C:/dev/shop")
    expect(sdk.renamed).toEqual([["a", "Login fix", "C:/dev/shop"]])
    sdk.renameSession = async () => {
      throw new Error("no file")
    }
    const logs: string[] = []
    expect(await h.setMeta("b", { title: "Grid" }, undefined, (l) => logs.push(l))).toEqual({
      title: "Grid",
    })
    expect(logs[0]).toMatch(/could not write the title/)
  })
})
