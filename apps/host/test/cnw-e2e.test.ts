// O41, end to end on one machine: a real CNW server and a real Host. The computer pairs with a code, dials out to
// CNW and proves itself with its key; a signed-in browser tab on CNW approves a request waiting in a session on the
// Host, the call runs, and the Host records who sent it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { createCnw } from "../../cnw/src/server.js"
import { CnwConnector, newComputerKey } from "../src/cnw/connector.js"
import { HostServer, type HostApp } from "../src/server.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

const ORIGIN = "https://cnw.home.arpa"
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cnw-e2e-"))
let s: Stack
let host: HostServer
let cnw: Awaited<ReturnType<typeof createCnw>>
let connector: CnwConnector | undefined
let port = 0

beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 30_000, phoneExpiryMs: 10_000 })
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
    listHistory: async () => [],
    log: () => undefined,
  }
  host = new HostServer({ app, token: "t".repeat(40), port: 0 })
  const lines: string[] = []
  cnw = await createCnw({ dataDir: dir, publicUrl: ORIGIN, log: (l) => void lines.push(l), webDir: path.join(dir, "none") })
  await cnw.app.listen({ port: 0, host: "127.0.0.1" })
  port = (cnw.app.server.address() as { port: number }).port
  ;(globalThis as { cnwSetupCode?: string }).cnwSetupCode = /Setup code for the first account \(shown once\): (\S+)/.exec(lines.join("\n"))?.[1]
}, 90000)
afterAll(async () => {
  connector?.stop()
  await cnw.app.close()
  for (const x of s.manager.liveSessions()) await x.close()
  await s.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

const until = async (ok: () => boolean, what: string, ms = 20_000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe("Neighbourhood Watch end to end (O41)", () => {
  it("pairs a computer, which dials out, and a signed-in tab on CNW approves a request on it", async () => {
    // The owner's first account, and a pairing code made in CNW.
    const code = (globalThis as { cnwSetupCode?: string }).cnwSetupCode!
    const setup = await cnw.app.inject({ method: "POST", url: "/api/setup", payload: { code, name: "ana", password: "a long password here" } })
    expect(setup.statusCode).toBe(200)
    const cookie = String(setup.headers["set-cookie"] ?? "").split(";")[0]!
    const made = await cnw.app.inject({ method: "POST", url: "/api/computers/code", headers: { cookie, "x-csrf-token": setup.json().csrf }, payload: { label: "Laptop" } })
    // The computer pairs with the code and its own key, then dials out.
    const key = newComputerKey()
    const paired = await cnw.app.inject({ method: "POST", url: "/agent/pair", payload: { code: made.json().code, publicKey: key.publicKey } })
    expect(paired.statusCode).toBe(200)
    const computer = paired.json().computer as string
    connector = new CnwConnector({
      url: `http://127.0.0.1:${port}`,
      computerId: computer,
      privateKey: key.privateKey,
      version: "test",
      attach: (socket, via) => host.attachRemote(socket as never, via),
      log: () => undefined,
    })
    connector.start()
    await until(() => connector!.status === "connected", "the computer to connect")

    // A request waits in a session on the Host.
    let result: ToolCallResult | undefined
    s.sdk.turn = async (api) => void (result = await api.callTool("Bash", { command: "pip install through-cnw" }))
    const session = await s.manager.start({ cwd: s.repo })
    session.prompt("go")
    await s.waitForPending()
    const requestId = s.pendingId()

    // A signed-in tab on CNW approves it.
    const tab = new WebSocket(`ws://127.0.0.1:${port}/ws/${computer}`, { headers: { cookie, origin: ORIGIN } })
    const got: Array<Record<string, unknown>> = []
    tab.on("message", (raw) => got.push(JSON.parse(String(raw))))
    await new Promise<void>((res, rej) => (tab.once("open", () => res()), tab.once("error", rej)))
    tab.send(JSON.stringify({ cmdId: "e2e-1", command: { type: "approve", requestId } }))
    await until(() => result !== undefined, "the approved call to run")
    expect(result).toMatchObject({ executed: true })
    // CNW wraps each frame from the computer as { type: "event", data }, as the interface's CnwConnection reads it.
    const reply = () => got.map((e) => e.data as Record<string, unknown> | undefined).find((d) => d?.type === "reply" && d.cmdId === "e2e-1")
    await until(() => reply() !== undefined, "the Host's reply in the tab")
    expect(reply()).toMatchObject({ ok: true })
    tab.close()

    const sent = s.records().find((r) => r.event === "cnw_command")
    expect(JSON.parse(sent!.inputJson)).toMatchObject({ command: "approve", user: "ana", signedIn: true })
    expect(s.records().filter((r) => r.event === "human_decision").at(-1)?.verdict.reason).toContain("Neighbourhood Watch")
  }, 120_000)
})
