// T-124: the codehouse command for scripts on this computer: its own token, sealed; only sessions (list, start in
// Manual mode, send, read), never decisions, policy, modes or the kill switch; every call recorded without the prompt.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CLI_TOKEN_FILE, CliAccess, registerCliRoutes, settledSession, type CliDeps } from "../src/cli-access.js"
import { parseCli, runCli } from "../src/cli-client.js"
import type { Protector } from "../src/relay/protector.js"
import { checkHostRequest } from "../src/server-guard.js"

/** Not protection: it turns the bytes round so a test can tell a sealed file from the token. */
const flip: Protector = {
  protect: async (b) => new Uint8Array([...b].reverse().map((x) => x ^ 0x5a)),
  unprotect: async (b) => new Uint8Array([...b].map((x) => x ^ 0x5a).reverse()),
}

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-cli-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const tokenOf = async (d: string) => new TextDecoder().decode(await flip.unprotect(new Uint8Array(Buffer.from(fs.readFileSync(path.join(d, CLI_TOKEN_FILE), "utf8").trim(), "base64"))))

describe("the command line's token (T-124)", () => {
  it("is off until switched on, sealed on disk, and stops when switched off or made again", async () => {
    const access = new CliAccess(dir, () => flip)
    expect(access.enabled).toBe(false)
    expect(access.allows("anything")).toBe(false)
    await access.enable(7882)
    const token = await tokenOf(dir)
    expect(fs.readFileSync(path.join(dir, CLI_TOKEN_FILE), "utf8")).not.toContain(token)
    expect(access.allows(token)).toBe(true)
    await access.enable(7882)
    expect(access.allows(token)).toBe(false)
    const again = await tokenOf(dir)
    const restarted = new CliAccess(dir, () => flip)
    await restarted.resumeIfOn(7882)
    expect(restarted.allows(again)).toBe(true)
    restarted.disable()
    expect(restarted.allows(again)).toBe(false)
    expect(fs.existsSync(path.join(dir, CLI_TOKEN_FILE))).toBe(false)
    const off = new CliAccess(dir, () => flip)
    await off.resumeIfOn(7882)
    expect(off.enabled).toBe(false)
  })
})

describe("what the command line may do (T-124)", () => {
  it("only lists, starts in Manual mode, sends and reads, with its own token, each call recorded without the prompt", async () => {
    const access = new CliAccess(dir, () => flip)
    await access.enable(7882)
    const token = await tokenOf(dir)
    const started: string[] = []
    const sent: Array<[string, string]> = []
    const recorded: Array<{ action: string; input: Record<string, unknown>; ok: boolean }> = []
    const s1 = { id: "s1", cwd: "C:\\dev\\shop", state: "idle", createdAt: "2026-11-19T10:00:00Z" }
    const deps: CliDeps = {
      list: () => [s1],
      start: async (cwd) => (started.push(cwd), "s2"),
      send: (id, prompt) => (id === "s1" || id === "s2" ? (sent.push([id, prompt]), true) : false),
      read: (id) => (id === "s1" ? { session: s1, lastAnswer: "All 12 tests pass." } : undefined),
      settled: async () => undefined,
      record: async (action, input, ok) => (recorded.push({ action, input, ok }), true),
    }
    const app = Fastify()
    registerCliRoutes(app, access, deps)
    const call = (method: "GET" | "POST", url: string, payload?: object, t: string | null = token) =>
      app.inject({ method, url, ...(payload ? { payload } : {}), headers: t !== null ? { authorization: `Bearer ${t}` } : {} })
    try {
      expect((await call("GET", "/cli/sessions", undefined, null)).statusCode).toBe(401)
      expect((await call("GET", "/cli/sessions", undefined, "the-launch-token")).statusCode).toBe(401)
      expect((await call("GET", "/cli/sessions")).json()).toEqual({ sessions: [s1] })
      expect((await call("POST", "/cli/sessions", { cwd: "C:\\dev\\shop", prompt: "Fix the test", mode: "bypassPermissions", extreme: true })).json()).toEqual({ id: "s2" })
      expect(started).toEqual(["C:\\dev\\shop"])
      expect(sent).toEqual([["s2", "Fix the test"]])
      expect((await call("POST", "/cli/sessions/nope/send", { prompt: "hi" })).statusCode).toBe(404)
      expect((await call("POST", "/cli/sessions/s1/send", { prompt: "And the docs", wait: true })).json()).toEqual({ sent: true, session: s1, lastAnswer: "All 12 tests pass." })
      expect((await call("GET", "/cli/sessions/s1")).json()).toEqual({ session: s1, lastAnswer: "All 12 tests pass." })
      // Nothing else is there, with its token or without.
      for (const url of ["/cli/sessions/s1/approve", "/cli/sessions/s1/mode", "/cli/kill", "/cli/policy"]) expect((await call("POST", url, {})).statusCode).toBe(404)
      expect(recorded.map((r) => [r.action, r.ok])).toEqual([["list", true], ["start", true], ["send", false], ["send", true], ["show", true]])
      expect(JSON.stringify(recorded)).not.toMatch(/Fix the test|And the docs/)
    } finally {
      await app.close()
    }
  })

  it("opens nothing under /api: the Host's guard wants the launch token there", () => {
    const req = { method: "GET", url: "/api/settings", headers: { host: "127.0.0.1:7882", authorization: "Bearer cli-token" } }
    expect(checkHostRequest(req, { token: "launch-token", port: 7882 })).toMatchObject({ ok: false, status: 401 })
  })
})

describe("the codehouse command (T-124)", () => {
  it("reads its arguments, t3code's thread start too", () => {
    expect(parseCli(["list"])).toEqual({ kind: "list" })
    expect(parseCli(["thread", "start", "C:\\dev\\shop", "Fix", "it"])).toEqual({ kind: "start", cwd: "C:\\dev\\shop", prompt: "Fix it" })
    expect(parseCli(["send", "s1", "go", "--wait"])).toEqual({ kind: "send", id: "s1", prompt: "go", wait: true })
    expect(parseCli(["approve", "s1"])).toMatch(/^Usage:/)
  })

  it("talks to 127.0.0.1 with its own token, and says when it is off", async () => {
    expect((await runCli(["list"], { dir, protector: flip })).code).toBe(3)
    await new CliAccess(dir, () => flip).enable(7999)
    const token = await tokenOf(dir)
    const asked: Array<{ url: string; auth: string; body?: string }> = []
    const fake = (async (url: string, init: RequestInit) => {
      asked.push({ url, auth: (init.headers as Record<string, string>).authorization!, ...(init.body ? { body: String(init.body) } : {}) })
      return new Response(JSON.stringify({ sent: true, session: { id: "s1", state: "idle", cwd: "C:\\dev\\shop", createdAt: "" }, lastAnswer: "Done." }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await runCli(["send", "s1", "go", "on", "--wait"], { dir, protector: flip, fetch: fake })
    expect(r).toEqual({ code: 0, out: "s1  idle  \n\nDone." })
    expect(asked).toEqual([{ url: "http://127.0.0.1:7999/cli/sessions/s1/send", auth: `Bearer ${token}`, body: '{"prompt":"go on","wait":true}' }])
  })

  it("waits for the turn to end, not for ever", async () => {
    const states = ["idle", "running", "running", "idle"]
    let i = 0
    await settledSession(() => states[Math.min(i++, states.length - 1)], 5000, 1, 1000)
    expect(i).toBe(4)
    const t = Date.now()
    await settledSession(() => "running", 50, 5)
    expect(Date.now() - t).toBeLessThan(1000)
  })
})
