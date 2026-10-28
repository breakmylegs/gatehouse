import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"
import type { Health, ServerEvent } from "@gatehouse/shared"
import { WS_SUBPROTOCOL } from "@gatehouse/shared"
import {
  allowedHosts,
  allowedOrigins,
  checkHostRequest,
  extractToken,
  offersSubprotocol,
  secretsEqual,
} from "../src/server-guard.js"
import { HostServer, type HostApp } from "../src/server.js"
import { buildStack, type Stack } from "./stack.js"

const TOKEN = "u".repeat(20) + "-ui-session-token-" + "z".repeat(10)

describe("checkHostRequest (invariant 7)", () => {
  const opts = { token: TOKEN, port: 47820 }
  const base = {
    method: "GET",
    url: "/",
    headers: { host: "127.0.0.1:47820" } as Record<string, string>,
  }

  it("serves public pages to the loopback address without a token", () => {
    expect(checkHostRequest(base, opts)).toEqual({ ok: true })
    expect(checkHostRequest({ ...base, headers: { host: "LOCALHOST:47820" } }, opts)).toEqual({
      ok: true,
    })
    expect(checkHostRequest({ ...base, url: "/assets/app.js?v=2" }, opts)).toEqual({ ok: true })
  })

  it("rejects any other Host header (DNS rebinding)", () => {
    for (const host of [
      "evil.example",
      "evil.example:47820",
      "127.0.0.1",
      "127.0.0.1:1",
      "[::1]:47820",
      "0.0.0.0:47820",
      "",
    ]) {
      expect(checkHostRequest({ ...base, headers: { host } }, opts), host).toMatchObject({
        ok: false,
        status: 403,
      })
    }
    expect(checkHostRequest({ ...base, headers: {} }, opts)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it("accepts only the Host's own origin, and no origin at all (a command line client)", () => {
    for (const origin of allowedOrigins(47820)) {
      expect(checkHostRequest({ ...base, headers: { ...base.headers, origin } }, opts)).toEqual({
        ok: true,
      })
    }
    for (const origin of [
      "https://evil.example",
      "http://127.0.0.1:47821",
      "http://localhost:3000",
      "null",
      "http://127.0.0.1:47820.evil.example",
      "https://127.0.0.1:47820",
    ]) {
      expect(
        checkHostRequest({ ...base, headers: { ...base.headers, origin } }, opts),
        origin,
      ).toMatchObject({ ok: false, status: 403 })
    }
  })

  it("needs the token for /api and /ws, from a bearer header or a websocket subprotocol", () => {
    for (const url of ["/api", "/api/state", "/api/anything/else", "/ws", "/ws?x=1"]) {
      expect(checkHostRequest({ ...base, url }, opts), url).toMatchObject({
        ok: false,
        status: 401,
      })
      expect(
        checkHostRequest(
          { ...base, url, headers: { ...base.headers, authorization: "Bearer wrong" } },
          opts,
        ),
      ).toMatchObject({ status: 401 })
      expect(
        checkHostRequest(
          { ...base, url, headers: { ...base.headers, authorization: `Bearer ${TOKEN}` } },
          opts,
        ),
        url,
      ).toEqual({ ok: true })
      expect(
        checkHostRequest(
          {
            ...base,
            url,
            headers: {
              ...base.headers,
              "sec-websocket-protocol": `${WS_SUBPROTOCOL}, token.${TOKEN}`,
            },
          },
          opts,
        ),
      ).toEqual({ ok: true })
    }
    expect(checkHostRequest({ ...base, url: "/apiary" }, opts)).toEqual({ ok: true }) // a different path, not /api
  })

  it("refuses a foreign origin even when the token is right (cross-site hijack)", () => {
    expect(
      checkHostRequest(
        {
          ...base,
          url: "/ws",
          headers: {
            ...base.headers,
            origin: "https://evil.example",
            authorization: `Bearer ${TOKEN}`,
          },
        },
        opts,
      ),
    ).toMatchObject({ ok: false, status: 403 })
  })

  it("extracts tokens and subprotocols, and compares secrets exactly", () => {
    expect(extractToken({ authorization: "Bearer abc" })).toBe("abc")
    expect(extractToken({ authorization: "Basic abc" })).toBeUndefined()
    expect(extractToken({ "sec-websocket-protocol": "gatehouse.v1,token.xyz" })).toBe("xyz")
    expect(extractToken({ "sec-websocket-protocol": "gatehouse.v1, token." })).toBeUndefined()
    expect(extractToken({})).toBeUndefined()
    expect(offersSubprotocol({ "sec-websocket-protocol": `x, ${WS_SUBPROTOCOL}` })).toBe(true)
    expect(offersSubprotocol({})).toBe(false)
    expect(secretsEqual("a", "a")).toBe(true)
    expect(secretsEqual("a", "b")).toBe(false)
    expect(allowedHosts(1)).toEqual(["127.0.0.1:1", "localhost:1"])
  })
})

let s: Stack
let server: HostServer
let port: number
let staticDir: string

function healthFor(stack: Stack): Health {
  const acct = stack.account.last()
  const ks = stack.kill.status()
  return {
    approver: { state: stack.approverServer ? "up" : "down", errors: [] },
    relay: { state: "not-configured", devices: 0 },
    signin: {
      signedIn: acct?.signedIn ?? false,
      ...(acct?.email ? { email: acct.email } : {}),
      ...(acct?.organization ? { organization: acct.organization } : {}),
      managedPolicy: acct?.managedPolicy ?? "unknown",
      orgOk: acct?.org.ok ?? false,
    },
    killSwitch: {
      engaged: ks.engaged,
      ...(ks.since ? { since: ks.since } : {}),
      ...(ks.by ? { by: ks.by } : {}),
      approverConfirmed: ks.approverConfirmed,
    },
    pwsh: { running: false },
  }
}

let hostApp: HostApp

beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  const app: HostApp = (hostApp = {
    manager: s.manager,
    broker: s.broker,
    kill: s.kill,
    checkpoints: s.checkpoints,
    usage: s.usage,
    account: s.account,
    audit: s.audit,
    engine: s.deps.engine,
    policy: () => s.store.current,
    pwsh: undefined,
    health: () => healthFor(s),
    expectedOrg: () => "ACN - Premium",
    listHistory: async (dir) => [{ sessionId: "old", dir }],
    log: () => undefined,
  })
  staticDir = fs.mkdtempSync(os.tmpdir() + "/gh-static-")
  server = new HostServer({ app, token: TOKEN, port: 0 })
  port = await server.start()
}, 90000)
afterAll(async () => {
  await server.close()
  await s.stop()
  fs.rmSync(staticDir, { recursive: true, force: true })
})

function httpGet(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        let body = ""
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on("error", reject)
    req.end()
  })
}

describe("the Host listener", () => {
  it("is bound to 127.0.0.1 only", async () => {
    expect(server.address).toBe("127.0.0.1")
    const others = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => (i as os.NetworkInterfaceInfo).address)
    if (others[0]) {
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect({ host: others[0], port, timeout: 2000 })
        sock.on(
          "connect",
          () => (sock.destroy(), reject(new Error("reachable on another address"))),
        )
        sock.on("error", () => resolve())
        sock.on("timeout", () => (sock.destroy(), resolve()))
      })
    }
  })

  it("serves a public placeholder page, and protects /api", async () => {
    const page = await httpGet("/")
    expect(page.status).toBe(200)
    expect(page.body).toContain("JCVC host is running")
    expect((await httpGet("/api/state")).status).toBe(401)
    expect((await httpGet("/api/state", { authorization: "Bearer nope" })).status).toBe(401)
    const state = await httpGet("/api/state", { authorization: `Bearer ${TOKEN}` })
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body)).toMatchObject({ type: "hello", expectedOrg: "ACN - Premium" })
  })

  it("rejects a wrong Host header and a foreign Origin, even with the token", async () => {
    expect((await httpGet("/", { host: "evil.example" })).status).toBe(403)
    expect(
      (
        await httpGet("/api/state", {
          authorization: `Bearer ${TOKEN}`,
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await httpGet("/api/state", {
          authorization: `Bearer ${TOKEN}`,
          origin: `http://127.0.0.1:${port}`,
        })
      ).status,
    ).toBe(200)
  })
})

interface Client {
  ws: WebSocket
  events: ServerEvent[]
  send(command: Record<string, unknown>): Promise<Extract<ServerEvent, { type: "reply" }>>
  waitFor<T extends ServerEvent["type"]>(
    type: T,
    pred?: (e: Extract<ServerEvent, { type: T }>) => boolean,
    ms?: number,
  ): Promise<Extract<ServerEvent, { type: T }>>
  close(): void
}

function connect(
  opts: { token?: string | null; origin?: string | null; protocols?: string[] } = {},
): Promise<Client> {
  const token = opts.token === undefined ? TOKEN : opts.token
  const protocols = opts.protocols ?? [WS_SUBPROTOCOL, ...(token ? [`token.${token}`] : [])]
  const headers: Record<string, string> = {}
  if (opts.origin !== null) headers.origin = opts.origin ?? `http://127.0.0.1:${port}`
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, protocols, { headers })
    const events: ServerEvent[] = []
    const waiters: { type: string; pred: (e: never) => boolean; resolve: (e: never) => void }[] = []
    let n = 0
    ws.on("message", (raw) => {
      const e = JSON.parse(String(raw)) as ServerEvent
      events.push(e)
      for (const w of [...waiters]) {
        if (w.type === e.type && w.pred(e as never)) {
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(e as never)
        }
      }
    })
    ws.on("unexpected-response", (_req, res) => {
      res.resume()
      ws.terminate()
      reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }))
    })
    ws.on("error", (e) => reject(e))
    ws.on("open", () => {
      const client: Client = {
        ws,
        events,
        send(command) {
          const cmdId = `c${++n}`
          ws.send(JSON.stringify({ cmdId, command }))
          return client.waitFor("reply", (e) => e.cmdId === cmdId)
        },
        waitFor(type, pred = () => true, ms = 40_000) {
          const found = events.find((e) => e.type === type && pred(e as never))
          if (found) return Promise.resolve(found as never)
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error(`timed out waiting for ${type}`)), ms)
            waiters.push({
              type,
              pred: pred as never,
              resolve: ((e: never) => (clearTimeout(t), res(e))) as never,
            })
          })
        },
        close: () => ws.close(),
      }
      resolve(client)
    })
  })
}

describe("the WebSocket handshake (invariant 7)", () => {
  it("opens with the token and the own origin, picks the plain subprotocol, and sends a snapshot", async () => {
    const c = await connect()
    expect(c.ws.protocol).toBe(WS_SUBPROTOCOL) // the token entry is never echoed back
    const hello = await c.waitFor("hello")
    expect(hello).toMatchObject({
      sessions: expect.any(Array),
      pending: [],
      expectedOrg: "ACN - Premium",
    })
    expect(hello.health.killSwitch.engaged).toBe(false)
    c.close()
  })

  it("opens without an Origin (a command line client) when the token is right", async () => {
    const c = await connect({ origin: null })
    await c.waitFor("hello")
    c.close()
  })

  it("refuses a missing token, a wrong token and a foreign origin", async () => {
    await expect(connect({ token: null })).rejects.toMatchObject({ status: 401 })
    await expect(connect({ token: "wrong" })).rejects.toMatchObject({ status: 401 })
    await expect(connect({ origin: "https://evil.example" })).rejects.toMatchObject({ status: 403 })
    await expect(connect({ origin: "http://localhost:3000" })).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe("commands over the WebSocket", () => {
  let c: Client
  beforeAll(async () => {
    c = await connect()
    await c.waitFor("hello")
  })
  afterAll(() => c.close())

  it("rejects bad JSON, unknown commands and invalid fields with a clear reply", async () => {
    c.ws.send("{not json")
    const bad = await c.waitFor("reply", (e) => e.error?.code === "invalid-json")
    expect(bad.ok).toBe(false)
    const unknown = await c.send({ type: "format_disk" })
    expect(unknown).toMatchObject({ ok: false, error: { code: "invalid-command" } })
    expect(await c.send({ type: "prompt", sessionId: "x", text: "" })).toMatchObject({
      ok: false,
      error: { code: "invalid-command" },
    })
    expect(await c.send({ type: "prompt", sessionId: "x", text: "hi" })).toMatchObject({
      ok: false,
      error: { code: "unknown-session" },
    })
  })

  it("never accepts a mode other than default or plan (invariant 3)", async () => {
    s.sdk.turn = async () => undefined
    const created = await c.send({ type: "create_session", cwd: s.repo })
    expect(created.ok).toBe(true)
    const sessionId = (created.data as { sessionId: string }).sessionId
    for (const mode of ["bypassPermissions", "dontAsk"]) {
      const r = await c.send({ type: "set_mode", sessionId, mode })
      expect(r, mode).toMatchObject({ ok: false, error: { code: "invalid-command" } })
    }
    expect(
      await c.send({ type: "create_session", cwd: s.repo, mode: "bypassPermissions" }),
    ).toMatchObject({ ok: false, error: { code: "invalid-command" } })
    expect(await c.send({ type: "set_mode", sessionId, mode: "plan" })).toMatchObject({ ok: true })
    expect(await c.send({ type: "set_mode", sessionId, mode: "default" })).toMatchObject({
      ok: true,
    })
    expect(await c.send({ type: "set_model", sessionId, model: "m1" })).toMatchObject({ ok: true })
    expect(await c.send({ type: "close_session", sessionId })).toMatchObject({ ok: true })
  })

  it("runs a session: events stream out, an approval arrives with the real command, approve resolves it", async () => {
    let result: unknown
    s.sdk.turn = async (api) => {
      api.say("working")
      result = await api.callTool("Bash", { command: "npm install via-ws" })
    }
    const created = await c.send({ type: "create_session", cwd: s.repo })
    const sessionId = (created.data as { sessionId: string }).sessionId
    expect(await c.send({ type: "prompt", sessionId, text: "do it" })).toMatchObject({ ok: true })

    const asked = await c.waitFor("approval_request", (e) => e.view.request.sessionId === sessionId)
    expect(asked.view.rawInput).toEqual({ command: "npm install via-ws" })
    expect(asked.view.request.verdict.ruleId).toBe("package-install")
    const waiting = await c.waitFor(
      "session",
      (e) => e.info.id === sessionId && e.info.state === "waiting",
    )
    expect(waiting.info.pendingApprovals).toBe(1)

    const reply = await c.send({ type: "approve", requestId: asked.view.request.id })
    expect(reply.ok).toBe(true)
    expect((reply.data as { resolution: { summary: string } }).resolution.summary).toMatch(
      /^Approved on desktop at \d\d:\d\d$/,
    )
    const resolved = await c.waitFor("approval_resolved", (e) => e.id === asked.view.request.id)
    expect(resolved.resolution).toMatchObject({ outcome: "allow", channel: "desktop" })
    await c.waitFor(
      "sdk_message",
      (e) => (e.message as { type?: string }).type === "result" && e.sessionId === sessionId,
    )
    expect(result).toMatchObject({ executed: true })
    expect(c.events.some((e) => e.type === "audit")).toBe(true)
    expect(c.events.some((e) => e.type === "usage")).toBe(true)
    await c.send({ type: "close_session", sessionId })
  })

  it("denies with a message, answers a question, and refuses a second answer", async () => {
    const results: Record<string, unknown> = {}
    s.sdk.turn = async (api) => {
      results.bash = await api.callTool("Bash", { command: "pip install via-ws-deny" })
      results.q = await api.callTool("AskUserQuestion", {
        questions: [{ question: "Which?", header: "H", options: [{ label: "a" }, { label: "b" }] }],
      })
    }
    const created = await c.send({ type: "create_session", cwd: s.repo })
    const sessionId = (created.data as { sessionId: string }).sessionId
    await c.send({ type: "prompt", sessionId, text: "go" })
    const first = await c.waitFor(
      "approval_request",
      (e) => e.view.request.toolName === "Bash" && e.view.request.sessionId === sessionId,
    )
    expect(
      await c.send({ type: "deny", requestId: first.view.request.id, message: "no thanks" }),
    ).toMatchObject({ ok: true })
    expect(await c.send({ type: "approve", requestId: first.view.request.id })).toMatchObject({
      ok: false,
      error: { code: "unknown-request" },
    })
    const q = await c.waitFor(
      "approval_request",
      (e) => e.view.request.kind === "question" && e.view.request.sessionId === sessionId,
    )
    expect(
      await c.send({ type: "answer", requestId: q.view.request.id, answers: { "Wrong?": "x" } }),
    ).toMatchObject({ ok: false, error: { code: "invalid-answer" } })
    expect(
      await c.send({ type: "answer", requestId: q.view.request.id, answers: { "Which?": "a" } }),
    ).toMatchObject({ ok: true })
    await c.waitFor(
      "sdk_message",
      (e) => (e.message as { type?: string }).type === "result" && e.sessionId === sessionId,
    )
    expect(results.bash).toMatchObject({
      executed: false,
      message: "Denied by the user: no thanks",
    })
    expect(results.q).toMatchObject({ executed: true })
    await c.send({ type: "close_session", sessionId })
  })

  it("previews exactly what remembering would create, and refuses what cannot be remembered", async () => {
    s.sdk.turn = async (api) => {
      void api.callTool("Bash", { command: "npm install preview-me" })
      void api.callTool("Bash", { command: "npm install a && npm install b" })
      await new Promise((r) => setTimeout(r, 4000))
    }
    const created = await c.send({ type: "create_session", cwd: s.repo })
    const sessionId = (created.data as { sessionId: string }).sessionId
    await c.send({ type: "prompt", sessionId, text: "go" })
    const one = await c.waitFor(
      "approval_request",
      (e) => e.view.rawInput.command === "npm install preview-me",
    )
    const two = await c.waitFor(
      "approval_request",
      (e) => e.view.rawInput.command === "npm install a && npm install b",
    )
    const ok = await c.send({ type: "remember_preview", requestId: one.view.request.id })
    expect(ok.data).toMatchObject({
      ok: true,
      candidate: { tool: "Bash", command: "npm install preview-me" },
      preview: "Allow Bash to run exactly: npm install preview-me",
    })
    const refused = await c.send({ type: "remember_preview", requestId: two.view.request.id })
    expect(refused.data).toMatchObject({ ok: false })
    expect(await c.send({ type: "remember_preview", requestId: "nope" })).toMatchObject({
      ok: false,
      error: { code: "unknown-request" },
    })
    s.broker.cancelAll()
    await c.send({ type: "close_session", sessionId })
  })

  it("lists, previews and restores checkpoints only for a folder that belongs to a session, and only with confirmation", async () => {
    s.sdk.turn = async () => undefined
    const created = await c.send({ type: "create_session", cwd: s.repo })
    const sessionId = (created.data as { sessionId: string }).sessionId
    fs.writeFileSync(`${s.repo}/src/a.ts`, "export const a = 99\n")
    const cp = await s.checkpoints.beforeEscalation(sessionId, s.repo, "test point")
    expect(cp).toBeDefined()
    fs.writeFileSync(`${s.repo}/src/a.ts`, "export const a = 5\n")

    const list = await c.send({ type: "checkpoint_list", cwd: s.repo, sessionId })
    expect((list.data as { ref: string }[]).map((x) => x.ref)).toContain(cp?.ref)
    const preview = await c.send({ type: "checkpoint_preview", cwd: s.repo, ref: cp?.ref })
    expect(preview.data).toMatchObject({ changes: [{ path: "src/a.ts", change: "modified" }] })
    expect((preview.data as { diff: string }).diff).toContain("+export const a = 99")

    expect(
      await c.send({
        type: "checkpoint_restore",
        cwd: s.repo,
        ref: cp?.ref,
        sessionId,
        confirm: false,
      }),
    ).toMatchObject({ ok: false, error: { code: "not-confirmed" } })
    expect(fs.readFileSync(`${s.repo}/src/a.ts`, "utf8").replace(/\r/g, "")).toBe(
      "export const a = 5\n",
    )
    expect(await c.send({ type: "checkpoint_list", cwd: os.tmpdir() })).toMatchObject({
      ok: false,
      error: { code: "unknown-folder" },
    })
    expect(
      await c.send({ type: "checkpoint_preview", cwd: "C:/Windows", ref: cp?.ref }),
    ).toMatchObject({ ok: false, error: { code: "unknown-folder" } })
    expect(
      await c.send({
        type: "checkpoint_restore",
        cwd: s.repo,
        ref: "refs/heads/master",
        sessionId,
        confirm: true,
      }),
    ).toMatchObject({ ok: false })
    const done = await c.send({
      type: "checkpoint_restore",
      cwd: s.repo,
      ref: cp?.ref,
      sessionId,
      confirm: true,
    })
    expect(done.ok).toBe(true)
    expect(fs.readFileSync(`${s.repo}/src/a.ts`, "utf8").replace(/\r/g, "")).toBe(
      "export const a = 99\n",
    )
    await c.send({ type: "close_session", sessionId })
  })

  it("lists past sessions and refreshes the account", async () => {
    expect((await c.send({ type: "list_history", dir: "C:/x" })).data).toEqual([
      { sessionId: "old", dir: "C:/x" },
    ])
    const acct = await c.send({ type: "refresh_account" })
    expect(acct.ok).toBe(true)
    expect(acct.data).toMatchObject({ signedIn: true, org: { ok: true } })
  })

  it("sets effort and Extreme approval per session, and audits the switch", async () => {
    const created = await c.send({
      type: "create_session",
      cwd: s.repo,
      mode: "acceptEdits",
      effort: "high",
      extreme: true,
    })
    expect(created.ok).toBe(true)
    const info = (created.data as { info: { mode: string; effort?: string; extreme?: boolean } })
      .info
    expect(info).toMatchObject({ mode: "acceptEdits", effort: "high", extreme: true })
    const sessionId = (created.data as { sessionId: string }).sessionId
    expect(s.sdk.queries.at(-1)?.options.effort).toBe("high")
    expect(await c.send({ type: "set_effort", sessionId, effort: "max" })).toMatchObject({
      ok: true,
    })
    expect(s.sdk.queries.at(-1)?.flags).toEqual([{ effortLevel: "max" }])
    expect(await c.send({ type: "set_extreme", sessionId, on: false })).toMatchObject({ ok: true })
    expect(await c.send({ type: "set_mode", sessionId, mode: "auto" })).toMatchObject({ ok: true })
    expect(await c.send({ type: "set_effort", sessionId, effort: "huge" as never })).toMatchObject({
      ok: false,
      error: { code: "invalid-command" },
    })
    await c.send({ type: "close_session", sessionId })
  })

  it("tells the window the new health after a sign-in check", async () => {
    const before = c.events.filter((e) => e.type === "health").length
    await c.send({ type: "refresh_account" })
    const after = c.events.filter((e) => e.type === "health")
    expect(after.length).toBeGreaterThan(before)
    expect(after.at(-1)).toMatchObject({ health: { signin: { signedIn: true, orgOk: true } } })
  })

  it("creates a missing folder with its parents, and refuses what cannot be used", async () => {
    const deep = path.join(s.repo, "new-parent", "child", "JCTest")
    const ok = await c.send({ type: "create_session", cwd: deep })
    expect(ok.ok).toBe(true)
    expect(fs.statSync(deep).isDirectory()).toBe(true)
    await c.send({ type: "close_session", sessionId: (ok.data as { sessionId: string }).sessionId })
    const file = path.join(s.repo, "README.md")
    expect(await c.send({ type: "create_session", cwd: file })).toMatchObject({
      ok: false,
      error: { code: "folder-missing" },
    })
    const rel = await c.send({ type: "create_session", cwd: "relative/dir" })
    expect(rel).toMatchObject({ ok: false, error: { code: "folder-missing" } })
    expect(rel.error?.message).toContain("full folder path")
    const letters = "ZYXWVUTSRQPONMLKJIHGFED".split("").filter((l) => !fs.existsSync(`${l}:/`))
    const gone = await c.send({ type: "create_session", cwd: `${letters[0]}:/x/y` })
    expect(gone).toMatchObject({ ok: false, error: { code: "folder-missing" } })
    expect(gone.error?.message).toContain("does not exist")
  })

  it("explains an organisation refusal with the code and a message", async () => {
    s.sdk.account = { email: "x@y.z", organization: "Another Org", apiProvider: "firstParty" }
    const r = await c.send({ type: "create_session", cwd: s.repo })
    expect(r).toMatchObject({ ok: false, error: { code: "org-guard.wrong-org" } })
    expect(r.error?.message).toContain("Another Org")
    s.sdk.account = { email: "a@b.c", organization: "ACN - Premium", apiProvider: "firstParty" }
  })

  it("engages and re-arms the kill switch, telling every client", async () => {
    const second = await connect()
    await second.waitFor("hello")
    const engaged = await c.send({ type: "kill" })
    expect(engaged).toMatchObject({ ok: true, data: { engaged: true, by: "desktop" } })
    const health = await second.waitFor("health", (e) => e.health.killSwitch.engaged)
    expect(health.health.killSwitch.by).toBe("desktop")
    expect(await c.send({ type: "create_session", cwd: s.repo })).toMatchObject({
      ok: false,
      error: { code: "kill-switch" },
    })
    const rearmed = await c.send({ type: "rearm" })
    expect(rearmed).toMatchObject({ ok: true, data: { engaged: false } })
    await second.waitFor("health", (e) => !e.health.killSwitch.engaged)
    second.close()
  })

  it("closes a connection that sends an oversized message", async () => {
    const big = await connect()
    await big.waitFor("hello")
    const closed = new Promise<number>((resolve) => big.ws.on("close", (code) => resolve(code)))
    big.ws.send("x".repeat((1 << 20) + 10))
    // 1009 is "message too big". Some platforms report 1006 (dropped) because the socket is torn down at once.
    expect([1009, 1006]).toContain(await closed)
  })

  it("serves a built interface at / and assets without a token, while /api still needs one", async () => {
    fs.mkdirSync(path.join(staticDir, "assets"), { recursive: true })
    fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>Gatehouse</title>")
    fs.writeFileSync(path.join(staticDir, "assets", "app.js"), "console.log(1)")
    const own = new HostServer({ app: hostApp, token: TOKEN, port: 0, staticDir })
    const ownPort = await own.start()
    try {
      const get = (p: string, headers: Record<string, string> = {}) =>
        fetch(`http://127.0.0.1:${ownPort}${p}`, { headers })
      const root = await get("/")
      expect(root.status).toBe(200)
      expect(await root.text()).toContain("<title>Gatehouse</title>")
      expect((await get("/assets/app.js")).status).toBe(200)
      expect((await get("/api/state")).status).toBe(401)
      expect((await get("/api/audit")).status).toBe(401)
      expect((await get("/api/state", { authorization: `Bearer ${TOKEN}` })).status).toBe(200)
    } finally {
      await own.close()
    }
  })

  it("stops promptly even when a client never answers the close handshake", async () => {
    const own = new HostServer({ app: hostApp, token: TOKEN, port: 0 })
    const ownPort = await own.start()
    const ws = new WebSocket(`ws://127.0.0.1:${ownPort}/ws`, [WS_SUBPROTOCOL, `token.${TOKEN}`], {
      headers: { origin: `http://127.0.0.1:${ownPort}` },
    })
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve())
      ws.on("error", reject)
    })
    // Stop the client reading at the socket level, so it never sees the server's close frame.
    ;(ws as unknown as { _socket: net.Socket })._socket.pause()
    const t0 = Date.now()
    await own.close()
    expect(Date.now() - t0).toBeLessThan(4000)
    ws.terminate()
  })
})
