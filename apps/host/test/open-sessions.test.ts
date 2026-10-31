import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { OpenSessionsStore, restoreOpenSessions } from "../src/open-sessions.js"
import type { StartSessionOptions } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-open-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const file = () => path.join(dir, `open-${++n}.json`)

const A = "019a0000-0000-7000-8000-00000000000a"
const B = "019a0000-0000-7000-8000-00000000000b"
const info = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  cwd: `C:/dev/${id.slice(-1)}`,
  project: id.slice(-1),
  mode: "default",
  extreme: false,
  state: "idle",
  pendingApprovals: 0,
  createdAt: `2026-10-30T10:00:0${id.slice(-1) === "a" ? 1 : 2}Z`,
  ...over,
})

describe("the sessions JCVC brings back after a restart", () => {
  it("keeps what each open session is, and drops one you close or that fails", async () => {
    const f = file()
    const store = new OpenSessionsStore(f)
    store.note(
      info(A, {
        state: "running",
        mode: "acceptEdits",
        sdkSessionId: "sdk-a",
        model: "claude-opus-5-5",
        effort: "max",
        extreme: true,
        resources: "low",
      }),
    )
    store.note(info(B, { kind: "chat", mode: "plan" }))
    await store.flush()
    expect(new OpenSessionsStore(f).list()).toEqual([
      {
        id: A,
        cwd: "C:/dev/a",
        sdkSessionId: "sdk-a",
        mode: "acceptEdits",
        model: "claude-opus-5-5",
        effort: "max",
        extreme: true,
        running: true,
        createdAt: "2026-10-30T10:00:01Z",
        resources: "low",
      },
      expect.objectContaining({ id: B, kind: "chat", mode: "plan", running: false }),
    ])
    store.note(info(B, { state: "ended" }))
    store.note(info(A, { state: "error" }))
    await store.flush()
    expect(new OpenSessionsStore(f).list()).toEqual([])
  })

  it("keeps the sessions JCVC itself closes on the way out", async () => {
    const f = file()
    const store = new OpenSessionsStore(f)
    store.note(info(A, { state: "running" }))
    await store.freeze()
    store.note(info(A, { state: "ended" }))
    store.forget(A)
    await store.flush()
    expect(new OpenSessionsStore(f).list().map((o) => o.id)).toEqual([A])
  })

  it("writes a moment after a change, so a crash still finds it", async () => {
    const f = file()
    new OpenSessionsStore(f).note(info(A))
    await new Promise((r) => setTimeout(r, 600))
    expect(new OpenSessionsStore(f).list().map((o) => o.id)).toEqual([A])
  })

  it("reads the file tolerantly, and never brings a mode back that is not allowed", async () => {
    const f = file()
    fs.writeFileSync(
      f,
      JSON.stringify({
        version: 2,
        sessions: [
          { id: A, cwd: "C:/dev/a", mode: "bypassPermissions", effort: "turbo", future: 1 },
          { id: "not an id", cwd: "C:/dev/x", mode: "default" },
          { id: B, mode: "default" },
        ],
      }),
    )
    const store = new OpenSessionsStore(f)
    expect(store.list()).toEqual([
      expect.objectContaining({ id: A, mode: "default", extreme: false, running: false }),
    ])
    expect(store.list()[0]?.effort).toBeUndefined()
    // What a newer version wrote stays for it, even once this version has changed the entry.
    store.note(info(A, { state: "running" }))
    await store.flush()
    expect(fs.readFileSync(f, "utf8")).toContain('"future": 1')
    expect(new OpenSessionsStore(f).list()[0]?.running).toBe(true)
    fs.writeFileSync(f, "{ not json")
    expect(new OpenSessionsStore(f).list()).toEqual([])
  })

  it("starts each one again with its id and settings, and drops one that cannot come back", async () => {
    const f = file()
    const store = new OpenSessionsStore(f)
    store.note(
      info(A, { state: "waiting", sdkSessionId: "sdk-a", mode: "auto", resources: "medium" }),
    )
    store.note(info(B, { sdkSessionId: "sdk-b" }))
    await store.flush()
    const started: StartSessionOptions[] = []
    const audited: string[] = []
    const n = await restoreOpenSessions(store, {
      start: async (o) => {
        started.push(o)
        if (o.resume === "sdk-b") throw new Error("that conversation is gone")
      },
      killed: () => false,
      audit: async (o) => audited.push(o.id),
      log: () => undefined,
    })
    expect(n).toBe(1)
    expect(started[0]).toEqual({
      cwd: "C:/dev/a",
      mode: "auto",
      extreme: false,
      resources: "medium",
      resume: "sdk-a",
      restore: { id: A, createdAt: "2026-10-30T10:00:01Z", wasRunning: true },
    })
    expect(audited).toEqual([A])
    await store.flush()
    expect(new OpenSessionsStore(f).list().map((o) => o.id)).toEqual([A])
  })

  it("starts nothing while the kill switch is engaged, and keeps the list for later", async () => {
    const f = file()
    const store = new OpenSessionsStore(f)
    store.note(info(A))
    await store.flush()
    const started: unknown[] = []
    const n = await restoreOpenSessions(store, {
      start: async (o) => void started.push(o),
      killed: () => true,
      audit: async () => undefined,
      log: () => undefined,
    })
    expect([n, started]).toEqual([0, []])
    expect(store.list().map((o) => o.id)).toEqual([A])
  })
})

describe("a session brought back", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(() => s.stop())

  it("has the id, start time and settings it had, carries on its conversation and says it was cut off", async () => {
    const session = await s.manager.start({
      cwd: s.repo,
      mode: "acceptEdits",
      effort: "high",
      resume: "sdk-earlier",
      restore: { id: A, createdAt: "2026-10-30T09:00:00Z", wasRunning: true },
    })
    expect(session.info()).toMatchObject({
      id: A,
      createdAt: "2026-10-30T09:00:00Z",
      mode: "acceptEdits",
      effort: "high",
      historyFrom: "sdk-earlier",
      restarted: { wasRunning: true },
    })
    expect(s.sdk.queries.at(-1)?.options).toMatchObject({
      resume: "sdk-earlier",
      permissionMode: "acceptEdits",
    })
    // A chat comes back in its own folder, still in Plan mode, and only in a folder JCVC made for chats.
    const chats = path.join(s.dir, "chats")
    fs.mkdirSync(path.join(chats, "vite-proxies"), { recursive: true })
    s.deps.chatsDir = chats
    const chat = await s.manager.start({
      cwd: path.join(chats, "vite-proxies"),
      kind: "chat",
      mode: "default",
      extreme: true,
      restore: { id: B, createdAt: "2026-10-30T09:01:00Z", wasRunning: false },
    })
    expect(chat.info()).toMatchObject({ id: B, mode: "plan", extreme: false })
    expect(chat.cwd).toBe(path.join(chats, "vite-proxies"))
    await expect(
      s.manager.start({
        cwd: s.repo,
        kind: "chat",
        restore: { id: B, createdAt: "2026-10-30T09:01:00Z", wasRunning: false },
      }),
    ).rejects.toThrow(/not one JCVC made for chats/)
    // A session you start yourself says neither.
    const fresh = (await s.manager.start({ cwd: s.repo })).info()
    expect(fresh.id).not.toBe(A)
    expect(fresh.historyFrom).toBeUndefined()
    expect(fresh.restarted).toBeUndefined()
  })
})
