// Uplift phase 3 (owner, 17 Nov): the board across computers and the one inbox. What waits comes first; an answer goes
// to the computer, whose rules decide; the risk is read from the computer, never from the page; and a Severe allow
// needs a person signed in within the last five minutes, never an allowed network.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FRESH_MS, order, summarise, whatOf } from "../src/board.js"
import { createCnw } from "../src/server.js"

const ORIGIN = "https://cnw.home.arpa"
const PW = "a long password here"
let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-board-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const pending = (id: string, risk: number, since: string, command = "npm test") => ({
  request: { id, kind: "permission", sessionId: "s1", toolName: "Bash", input: { command }, project: "billing", verdict: { risk, ruleId: "bash-unknown", reason: "Not on the list." }, createdAt: since },
  hardDeadline: "2026-11-18T12:00:00Z",
})
const state = (p: unknown[]) => ({
  sessions: [{ state: "running" }, { state: "waiting" }, { state: "ended" }],
  pending: p,
  health: { killSwitch: { engaged: false } },
})

describe("the board's summary of a computer", () => {
  it("keeps only what the board shows, and treats a request it cannot read as the highest risk", () => {
    const s = summarise({ id: "c1", label: "Laptop" }, state([pending("r1", 40, "2026-11-18T10:00:00Z"), { request: { id: "r2", verdict: {} } }, { nonsense: 1 }]))
    expect(s.sessions).toEqual({ total: 2, working: 1, waiting: 1 })
    expect(s.waiting.map((w) => [w.requestId, w.risk, w.what])).toEqual([
      ["r1", 40, "npm test"],
      ["r2", 100, ""],
    ])
    expect(whatOf("Write", { file_path: "C:/p/a.ts", content: "secret body" })).toBe("C:/p/a.ts")
    expect(summarise({ id: "c", label: "x" }, "not an object")).toMatchObject({ sessions: { total: 0 }, waiting: [] })
  })

  it("puts computers with something waiting first, oldest wait first, then working, idle and offline; the inbox oldest first", () => {
    const row = (id: string, online: boolean, since: string[], working = 0) => ({
      id,
      label: id,
      online,
      sessions: { total: 1, working, waiting: since.length },
      waiting: since.map((s, i) => ({ ...summarise({ id, label: id }, state([pending(`${id}${i}`, 10, s)])).waiting[0]! })),
    })
    const { board, inbox } = order([row("off", false, []), row("idle", true, []), row("busy", true, [], 1), row("late", true, ["2026-11-18T10:05:00Z"]), row("early", true, ["2026-11-18T10:01:00Z"])])
    expect(board.map((r) => r.id)).toEqual(["early", "late", "busy", "idle", "off"])
    expect(inbox.map((w) => w.computer)).toEqual(["early", "late"])
  })
})

describe("the inbox", () => {
  async function connected(p: unknown[]) {
    const lines: string[] = []
    let now = Date.parse("2026-11-18T10:10:00Z")
    const { app, hub } = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(dir, "none"), now: () => now })
    const code = /shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
    const s = await app.inject({ method: "POST", url: "/api/setup", payload: { code, email: "ana@example.com", password: PW } })
    const headers = { cookie: String(s.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": s.json().csrf as string }
    const made = await app.inject({ method: "POST", url: "/api/computers/code", headers, payload: { label: "Laptop" } })
    const keys = crypto.generateKeyPairSync("ed25519")
    const paired = await app.inject({ method: "POST", url: "/agent/pair", payload: { code: made.json().code, publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url"), label: "Laptop" } })
    const id = paired.json().computer as string
    // The computer: signs its challenge, answers GET /api/state, and keeps every command it is sent.
    const commands: Array<Record<string, unknown>> = []
    let current = p
    const sock = {
      send: (d: string) => {
        const m = JSON.parse(d) as Record<string, unknown>
        if (m.type === "challenge")
          queueMicrotask(() => hub.agentMessage(sock, JSON.stringify({ type: "hello", computer: id, protocol: 2, signature: crypto.sign(null, Buffer.from(m.challenge as string), keys.privateKey).toString("base64url") })))
        if (m.type === "http") queueMicrotask(() => hub.agentMessage(sock, JSON.stringify({ type: "http_reply", id: m.id, status: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(state(current))).toString("base64") })))
        if (m.type === "command") commands.push(m)
      },
      close: () => undefined,
    }
    hub.agentOpened(sock)
    await new Promise((r) => setTimeout(r, 10))
    return { app, headers, id, commands, setPending: (q: unknown[]) => (current = q), later: (ms: number) => (now += ms) }
  }

  it("lists what waits, and sends an answer to the computer as the person who gave it", async () => {
    const c = await connected([pending("r1", 30, "2026-11-18T10:00:00Z")])
    const board = (await c.app.inject({ method: "GET", url: "/api/board", headers: c.headers })).json()
    expect(board.board[0]).toMatchObject({ label: "Laptop", online: true, sessions: { working: 1, waiting: 1 } })
    expect(board.inbox.map((w: { requestId: string }) => w.requestId)).toEqual(["r1"])
    const ok = await c.app.inject({ method: "POST", url: "/api/inbox/answer", headers: c.headers, payload: { computer: c.id, requestId: "r1", decision: "allow" } })
    expect(ok.statusCode).toBe(200)
    expect(c.commands).toEqual([{ type: "command", from: "ana@example.com", signedIn: true, data: { type: "approve", requestId: "r1" } }])
    // One no longer waiting is said so, and nothing is sent.
    c.setPending([])
    const gone = await c.app.inject({ method: "POST", url: "/api/inbox/answer", headers: c.headers, payload: { computer: c.id, requestId: "r1", decision: "deny" } })
    expect(gone.statusCode).toBe(410)
    expect(c.commands).toHaveLength(1)
    await c.app.close()
  })

  it("wants a recent sign-in to allow a Severe request, with the risk read from the computer, and never an allowed network", async () => {
    const c = await connected([pending("r9", 90, "2026-11-18T10:00:00Z", "rm -rf build")])
    // Signed in more than five minutes ago: not recent enough for a Severe allow.
    c.later(FRESH_MS + 1000)
    const stale = await c.app.inject({ method: "POST", url: "/api/inbox/answer", headers: c.headers, payload: { computer: c.id, requestId: "r9", decision: "allow" } })
    expect(stale.statusCode).toBe(428)
    expect(stale.json().reauth).toBe(true)
    expect(c.commands).toHaveLength(0)
    // Deny is always one step.
    expect((await c.app.inject({ method: "POST", url: "/api/inbox/answer", headers: c.headers, payload: { computer: c.id, requestId: "r9", decision: "deny" } })).statusCode).toBe(200)
    expect(c.commands.at(-1)!.data).toEqual({ type: "deny", requestId: "r9" })
    // Signing in again makes it recent; a wrong password does not.
    expect((await c.app.inject({ method: "POST", url: "/api/reauth", headers: c.headers, payload: { password: "wrong" } })).statusCode).toBe(403)
    expect((await c.app.inject({ method: "POST", url: "/api/reauth", headers: c.headers, payload: { password: PW } })).statusCode).toBe(200)
    expect((await c.app.inject({ method: "POST", url: "/api/inbox/answer", headers: c.headers, payload: { computer: c.id, requestId: "r9", decision: "allow" } })).statusCode).toBe(200)
    expect(c.commands.at(-1)!.data).toEqual({ type: "approve", requestId: "r9" })
    // From an allowed network, without signing in: refused.
    await c.app.inject({ method: "PUT", url: "/api/allowlist", headers: c.headers, payload: { ranges: ["127.0.0.0/8"] } })
    const n = c.commands.length
    const net = await c.app.inject({ method: "POST", url: "/api/inbox/answer", payload: { computer: c.id, requestId: "r9", decision: "allow" } })
    expect(net.statusCode).toBe(401)
    expect(c.commands).toHaveLength(n)
    await c.app.close()
  })
})
