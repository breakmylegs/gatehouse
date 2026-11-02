import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
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

describe("the sessions Codehouse brings back after a restart", () => {
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

  it("keeps the sessions Codehouse itself closes on the way out", async () => {
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

  it("brings two back at a time, so a slow one does not hold up all the rest", async () => {
    const f = file()
    const store = new OpenSessionsStore(f)
    const ids = ["a", "b", "c"].map((c) => `019a0000-0000-7000-8000-0000000000${c}${c}`)
    ids.forEach((id, i) =>
      store.note(info(id, { createdAt: `2026-10-30T10:00:0${i}Z`, cwd: `C:/dev/${i}` })),
    )
    const live = new Set<string>()
    const releases: Array<() => void> = []
    let peak = 0
    const restoring = restoreOpenSessions(store, {
      start: (o) =>
        new Promise<void>((resolve) => {
          live.add(o.restore!.id)
          peak = Math.max(peak, live.size)
          releases.push(() => {
            live.delete(o.restore!.id)
            resolve()
          })
        }),
      killed: () => false,
      audit: async () => undefined,
      log: () => undefined,
    })
    await new Promise((r) => setTimeout(r, 30))
    expect([...live]).toEqual(ids.slice(0, 2))
    releases[0]!()
    await new Promise((r) => setTimeout(r, 30))
    expect([...live]).toEqual([ids[1], ids[2]])
    releases[1]!()
    releases[2]!()
    expect(await restoring).toBe(3)
    expect(peak).toBe(2)
  })

  it("keeps a chat's project, instructions and research choice across a restart, and starts it with them", async () => {
    const f = file()
    const store = new OpenSessionsStore(f)
    store.note(
      info(A, {
        kind: "chat",
        mode: "plan",
        chatProject: "Home",
        instructions: "Be brief.",
        research: true,
      }),
    )
    await store.flush()
    expect(new OpenSessionsStore(f).list()[0]).toMatchObject({
      chatProject: "Home",
      instructions: "Be brief.",
      research: true,
    })
    const started: StartSessionOptions[] = []
    await restoreOpenSessions(store, {
      start: async (o) => void started.push(o),
      killed: () => false,
      audit: async () => undefined,
      log: () => undefined,
    })
    expect(started[0]).toMatchObject({
      kind: "chat",
      chatProject: "Home",
      instructions: "Be brief.",
      research: true,
    })
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
    // A chat comes back in its own folder, still in Plan mode, and only in a folder Codehouse made for chats.
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
    ).rejects.toThrow(/not one Codehouse made for chats/)
    // A session you start yourself says neither.
    const fresh = (await s.manager.start({ cwd: s.repo })).info()
    expect(fresh.id).not.toBe(A)
    expect(fresh.historyFrom).toBeUndefined()
    expect(fresh.restarted).toBeUndefined()
  })
})

describe("sessions coming back are shown at once (owner, 31 Oct)", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(() => s.stop())

  const C = "019a0000-0000-7000-8000-00000000000c"
  const D = "019a0000-0000-7000-8000-00000000000d"

  it("lists every one as starting before any has started, then each as it comes back", async () => {
    const f = file()
    const store = new OpenSessionsStore(f)
    store.note(
      info(C, { cwd: s.repo, sdkSessionId: "sdk-c", mode: "acceptEdits", state: "running" }),
    )
    store.note(info(D, { cwd: s.repo, createdAt: "2026-10-30T10:00:09Z" }))
    const seen: string[][] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const restoring = restoreOpenSessions(store, {
      expect: (o) => s.manager.expect(o),
      start: async (o) => {
        seen.push(s.manager.list().map((i) => `${i.id.slice(-1)} ${i.state}`))
        await gate
        return s.manager.start(o)
      },
      killed: () => false,
      audit: async () => undefined,
      log: () => undefined,
    })
    await new Promise((r) => setTimeout(r, 50))
    // Before the first has started, both are already listed, with what they had.
    expect(seen[0]).toEqual(["c starting", "d starting"])
    expect(s.manager.list().find((i) => i.id === C)).toMatchObject({
      mode: "acceptEdits",
      historyFrom: "sdk-c",
      restarted: { wasRunning: true },
    })
    release()
    expect(await restoring).toBe(2)
    // C was mid-run, so it may already be carrying on; neither is still starting.
    const states = s.manager
      .list()
      .filter((i) => i.id === C || i.id === D)
      .map((i) => i.state)
    expect(states).toHaveLength(2)
    for (const state of states) expect(["idle", "running"]).toContain(state)
  })

  it("keeps one that could not come back, with why, so Start again or Close can follow", async () => {
    const E = "019a0000-0000-7000-8000-00000000000e"
    const opts: StartSessionOptions = {
      cwd: s.repo,
      restore: { id: E, createdAt: "2026-10-30T09:00:00Z", wasRunning: false },
    }
    s.manager.expect(opts)
    s.sdk.mcpStatus = [
      { name: "files", status: "connected", config: { type: "stdio", command: "x" } },
    ]
    await expect(s.manager.start(opts)).rejects.toThrow()
    expect(s.manager.list().find((i) => i.id === E)).toMatchObject({
      state: "error",
      error: expect.stringMatching(/could not bring this session back: .*outside the process/),
    })
    s.sdk.mcpStatus = [
      { name: "companion", status: "connected", config: { type: "sdk", name: "companion" } },
    ]
    const again = await s.manager.forceStop(E)
    expect(again.info()).toMatchObject({ id: E, state: "idle" })
    // Started again by you, it does not carry on by itself.
    expect(again.info().restarted).toMatchObject({ forced: true })
    const F = "019a0000-0000-7000-8000-00000000000f"
    s.manager.expect({ ...opts, restore: { ...opts.restore!, id: F } })
    expect(s.manager.dismiss(F)).toBe(true)
    expect(s.manager.list().some((i) => i.id === F)).toBe(false)
    expect(s.manager.dismiss(E)).toBe(false)
  })
})

describe("a session that is slow to start (owner, 31 Oct: one sat on Starting and End did nothing)", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(() => s.stop())
  afterEach(() => {
    s.sdk.holdStart = undefined
    delete s.deps.startTimeoutMs
  })

  const G = "019a0000-0000-7000-8000-000000000010"
  const H = "019a0000-0000-7000-8000-000000000011"
  const J = "019a0000-0000-7000-8000-000000000012"
  const opts = (id: string): StartSessionOptions => ({
    cwd: s.repo,
    restore: { id, createdAt: "2026-10-30T09:00:00Z", wasRunning: false },
  })

  it("stops waiting after a limit, closes Claude Code and says so, with Start again to follow", async () => {
    s.deps.startTimeoutMs = 2000
    s.sdk.holdStart = new Promise(() => undefined)
    s.manager.expect(opts(G))
    await expect(s.manager.start(opts(G))).rejects.toThrow(
      /had not finished starting after 2 seconds/,
    )
    expect(s.sdk.queries.at(-1)?.closed).toBe(true)
    expect(s.manager.list().find((i) => i.id === G)).toMatchObject({
      state: "error",
      error: expect.stringMatching(/stopped waiting\. Start again tries once more/),
    })
    // Start again, once it can start, brings it back under the same id.
    s.sdk.holdStart = undefined
    expect((await s.manager.forceStop(G)).info()).toMatchObject({ id: G, state: "idle" })
  })

  it("closes at once when you close it while it starts, and shows no failure", async () => {
    s.sdk.holdStart = new Promise(() => undefined)
    const states: string[] = []
    s.manager.on("session", (i) => (i.id === H ? states.push(i.state) : undefined))
    s.manager.expect(opts(H))
    const starting = s.manager.start(opts(H))
    const settled = starting.then(
      () => "started",
      () => "refused",
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(s.manager.dismiss(H)).toBe(true)
    expect(await settled).toBe("refused")
    expect(s.sdk.queries.at(-1)?.closed).toBe(true)
    expect(states).not.toContain("error")
    expect(s.manager.list().some((i) => i.id === H)).toBe(false)
    expect(s.manager.get(H)).toBeUndefined()
  })

  it("does not start one that was closed before its turn came", async () => {
    s.manager.expect(opts(J))
    expect(s.manager.dismiss(J)).toBe(true)
    const before = s.sdk.queries.length
    await expect(s.manager.start(opts(J))).rejects.toThrow(/closed before it started/)
    expect(s.sdk.queries.length).toBe(before)
    expect(s.manager.list().some((i) => i.id === J)).toBe(false)
  })
})
