// O41: a command from Neighbourhood Watch is recorded first as cnw_command, with the CNW user; one that cannot be
// recorded is refused. Its decisions are a person's (human-desktop), recorded on the desktop channel, which older
// copies of Codehouse can read after an update is undone (no new audit channel).
import { EventEmitter } from "node:events"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { HostServer, type HostApp } from "../src/server.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  sent: Array<Record<string, unknown>> = []
  send(t: string) {
    this.sent.push(JSON.parse(t))
  }
  close() {
    this.readyState = 3
    this.emit("close")
  }
}

let s: Stack
let server: HostServer
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  const app: HostApp = {
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
    health: () => ({}) as never,
    expectedOrg: () => "ACN - Premium",
    log: () => undefined,
  }
  server = new HostServer({ app, token: "t".repeat(40), port: 0 })
}, 90000)
afterAll(async () => {
  for (const x of s.manager.liveSessions()) await x.close()
  await s.stop()
})

/** A request waiting on a person, from a real session, and the call's result once it is decided. */
async function waiting(): Promise<{ id: string; result: Promise<ToolCallResult | undefined> }> {
  let resolveResult: (r: ToolCallResult | undefined) => void = () => undefined
  const result = new Promise<ToolCallResult | undefined>((r) => (resolveResult = r))
  s.sdk.turn = async (api) => resolveResult(await api.callTool("Bash", { command: "pip install from-cnw" }))
  const session = await s.manager.start({ cwd: s.repo })
  session.prompt("go")
  await s.waitForPending()
  return { id: s.pendingId(), result }
}

/** Sends a command as CNW would and waits for its reply. */
async function command(socket: FakeSocket, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = socket.sent.length
  socket.emit("message", Buffer.from(JSON.stringify({ cmdId: "c1", command: data })))
  for (let i = 0; i < 200; i++) {
    const reply = socket.sent.slice(before).find((e) => e.type === "reply")
    if (reply) return reply
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error("no reply")
}

describe("commands from Neighbourhood Watch (O41)", () => {
  it("records who sent each command, and records its approval as a person's on the desktop channel", async () => {
    const socket = new FakeSocket()
    server.attachRemote(socket as never, { user: "ana", signedIn: true })
    const { id, result } = await waiting()
    expect(await command(socket, { type: "approve", requestId: id })).toMatchObject({ ok: true })
    expect(await result).toMatchObject({ executed: true })
    const records = s.records()
    expect(records.find((r) => r.event === "cnw_command")).toMatchObject({
      channel: "desktop",
      tool: "cnw",
      verdict: { ruleId: "cnw-command", decidedBy: "human-desktop" },
    })
    expect(JSON.parse(records.find((r) => r.event === "cnw_command")!.inputJson)).toMatchObject({
      command: "approve",
      user: "ana",
      signedIn: true,
      requestId: id,
    })
    const decision = records.filter((r) => r.event === "human_decision").at(-1)
    expect(decision).toMatchObject({ channel: "desktop", verdict: { decidedBy: "human-desktop" } })
    expect(decision?.verdict.reason).toContain("Neighbourhood Watch")
  })

  it("refuses a command it cannot record, and the request goes on waiting", async () => {
    const socket = new FakeSocket()
    server.attachRemote(socket as never, { user: "ana", signedIn: true })
    const { id, result } = await waiting()
    const original = s.audit.record.bind(s.audit)
    s.audit.record = async (e) => (e.event === "cnw_command" ? false : original(e))
    try {
      expect(await command(socket, { type: "approve", requestId: id })).toMatchObject({
        ok: false,
        error: { code: "audit" },
      })
    } finally {
      s.audit.record = original
    }
    expect(s.broker.get(id)).toBeDefined()
    s.broker.resolve(id, { kind: "decision", decision: "deny" }, "desktop")
    expect(await result).toMatchObject({ executed: false })
  })
})
