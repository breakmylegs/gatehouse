import http from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { WS_SUBPROTOCOL } from "@gatehouse/shared"
import { HostServer, type HostApp } from "../src/server.js"
import { buildStack, type Stack } from "./stack.js"

const TOKEN = "v".repeat(20) + "-shutdown-token-" + "y".repeat(10)
let s: Stack
let app: HostApp

beforeAll(async () => {
  s = await buildStack()
  app = {
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
    health: () => ({
      approver: { state: "up", errors: [] },
      relay: { state: "not-configured", devices: 0 },
      signin: { signedIn: true, managedPolicy: "unknown", orgOk: true },
      killSwitch: { engaged: false, approverConfirmed: false },
      pwsh: { running: false },
    }),
    expectedOrg: () => "ACN - Premium",
    listHistory: async () => [],
    log: () => undefined,
  }
}, 60000)
afterAll(() => s.stop())

describe("shutting the Host down", () => {
  it("finishes quickly when a client stops answering, and when refused upgrade attempts left sockets open", async () => {
    const server = new HostServer({ app, token: TOKEN, port: 0 })
    const port = await server.start()

    // A refused upgrade whose socket the client simply keeps open.
    const lingering = http.request({
      host: "127.0.0.1",
      port,
      headers: {
        host: `127.0.0.1:${port}`,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    })
    lingering.on("response", (res) => res.resume())
    lingering.on("error", () => undefined)
    lingering.end()

    // A real client that stops reading, so it never acknowledges the server's close frame.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [WS_SUBPROTOCOL, `token.${TOKEN}`], {
      headers: { origin: `http://127.0.0.1:${port}` },
    })
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve())
      ws.on("error", reject)
    })
    ;(ws as unknown as { _socket: { pause(): void } })._socket.pause()
    await new Promise((r) => setTimeout(r, 100))

    const t0 = Date.now()
    await server.close()
    expect(Date.now() - t0).toBeLessThan(4000)
    ws.terminate()
    lingering.destroy()
  })
})
