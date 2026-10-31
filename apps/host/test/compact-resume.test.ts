// Compact after this turn, and Resume starting a conversation with what it last ran with (owner, 31 Oct).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { SessionMetaStore } from "../src/session-meta.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack()
}, 60000)
afterAll(() => s.stop())

/** A turn that waits until it is let go. */
function held() {
  let release: () => void = () => undefined
  s.sdk.turn = async (api, text) => {
    if (text === "/compact") return api.say("Compacted.")
    await new Promise<void>((r) => (release = r))
    api.say("Done.")
  }
  return () => release()
}

describe("Compact after this turn", () => {
  it("compacts at once between turns", async () => {
    s.sdk.turn = async (api) => api.say("Compacted.")
    const session = await s.manager.start({ cwd: s.repo })
    session.compact()
    await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toEqual(["/compact"]))
  })

  it("waits for the running turn, says so, then compacts", async () => {
    const release = held()
    const session = await s.manager.start({ cwd: s.repo })
    session.prompt("build it")
    await vi.waitFor(() => expect(session.info().state).toBe("running"))
    session.compact()
    expect(session.info().compactPending).toBe(true)
    expect(s.sdk.queries.at(-1)?.prompts).toEqual(["build it"])
    release()
    await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toEqual(["build it", "/compact"]))
    expect(session.info().compactPending).toBeUndefined()
  })

  it("is called off when you stop the turn", async () => {
    const release = held()
    const session = await s.manager.start({ cwd: s.repo })
    session.prompt("build it")
    await vi.waitFor(() => expect(session.info().state).toBe("running"))
    session.compact()
    await session.stop()
    release()
    await new Promise((r) => setTimeout(r, 200))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual(["build it"])
    expect(session.info().compactPending).toBeUndefined()
  })
})

describe("Resume keeps the settings a session had", () => {
  it("starts with the model, effort, mode and Extreme approval it last ran with, unless you chose others", async () => {
    s.deps.resumeSettings = (id) =>
      id === "sdk-earlier"
        ? {
            model: "claude-sonnet-5-5",
            effort: "max",
            mode: "acceptEdits",
            extreme: true,
            resources: "low",
          }
        : {}
    try {
      const again = await s.manager.start({ cwd: s.repo, resume: "sdk-earlier" })
      expect(again.info()).toMatchObject({ effort: "max", mode: "acceptEdits", extreme: true })
      expect(again.restartOptions().resources).toBe("low")
      // Claude Code is started with them; its own first message then names the model in use.
      expect(s.sdk.queries.at(-1)?.options).toMatchObject({
        model: "claude-sonnet-5-5",
        permissionMode: "acceptEdits",
        effort: "max",
      })
      const chosen = await s.manager.start({ cwd: s.repo, resume: "sdk-earlier", mode: "plan" })
      expect(chosen.info().mode).toBe("plan")
      const fresh = await s.manager.start({ cwd: s.repo })
      expect(fresh.info()).toMatchObject({ mode: "default", extreme: false })
    } finally {
      delete s.deps.resumeSettings
    }
  })
})

describe("the settings kept for Resume", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-meta-"))
  const file = path.join(dir, "sessions.json")
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("keeps them by Claude Code id beside the title, and reads back only what JCVC allows", async () => {
    const store = new SessionMetaStore(file)
    await store.set("c1", { title: "Login fix" })
    store.keepSettings("c1", { model: "claude-opus-5-5", effort: "high", mode: "auto", extreme: false })
    await vi.waitFor(() => expect(fs.readFileSync(file, "utf8")).toContain("claude-opus-5-5"))
    const again = new SessionMetaStore(file)
    expect(again.get("c1")).toEqual({ title: "Login fix" })
    expect(again.settings("c1")).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
      mode: "auto",
      extreme: false,
    })
    // A mode JCVC never allows, written by hand or by anything else, does not come back (invariant 3).
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      sessions: Record<string, Record<string, unknown>>
    }
    raw.sessions.c2 = { settings: { mode: "bypassPermissions", resources: "huge", futureKey: 1 } }
    fs.writeFileSync(file, JSON.stringify(raw))
    expect(new SessionMetaStore(file).settings("c2")).toEqual({})
    expect(new SessionMetaStore(file).settings("missing")).toEqual({})
  })
})
