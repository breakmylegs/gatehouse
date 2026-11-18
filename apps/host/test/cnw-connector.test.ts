// O41: Codehouse's Neighbourhood Watch connector signs CNW's challenge with its own key, joins the Host as a client
// per CNW user (with whether they signed in), passes commands in and events out, reconnects after a drop, and stops
// for good when CNW says the computer is not paired.
import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { CNW_PROTOCOL, CnwConnector, newComputerKey, protocolGap, type VirtualSocket } from "../src/cnw/connector.js"

class FakeWs extends EventEmitter {
  readyState = 1
  sent: Array<Record<string, unknown>> = []
  send(t: string) {
    this.sent.push(JSON.parse(t))
  }
  ping() {}
  close(code = 1000) {
    this.readyState = 3
    this.emit("close", code)
  }
}

describe("the Neighbourhood Watch connector (O41)", () => {
  it("proves the computer, then passes commands in with who sent them, and events out", () => {
    const key = newComputerKey()
    const sockets: FakeWs[] = []
    const attached: Array<{ socket: VirtualSocket; user: string; signedIn: boolean }> = []
    const c = new CnwConnector({
      url: "https://cnw.home.arpa",
      computerId: "c1",
      privateKey: key.privateKey,
      version: "2.0.351",
      attach: (socket, via) => void attached.push({ socket, ...via }),
      log: () => undefined,
      createSocket: (url) => {
        expect(url).toBe("wss://cnw.home.arpa/agent")
        const w = new FakeWs()
        sockets.push(w)
        return w as never
      },
    })
    c.start()
    const ws = sockets[0]!
    ws.emit("message", Buffer.from(JSON.stringify({ type: "challenge", challenge: "abc" })))
    const hello = ws.sent[0]!
    expect(hello).toMatchObject({ type: "hello", computer: "c1", version: "2.0.351" })
    const pub = crypto.createPublicKey({ key: Buffer.from(key.publicKey, "base64url"), format: "der", type: "spki" })
    expect(crypto.verify(null, Buffer.from("abc"), pub, Buffer.from(hello.signature as string, "base64url"))).toBe(true)
    ws.emit("message", Buffer.from(JSON.stringify({ type: "welcome" })))
    expect(c.status).toBe("connected")

    const received: string[] = []
    ws.emit("message", Buffer.from(JSON.stringify({ type: "command", from: "ana", signedIn: false, data: { type: "approve", requestId: "r1", cmdId: "x" } })))
    expect(attached).toHaveLength(1)
    expect(attached[0]).toMatchObject({ user: "ana", signedIn: false })
    attached[0]!.socket.on("message", (b: Buffer) => received.push(b.toString()))
    ws.emit("message", Buffer.from(JSON.stringify({ type: "command", from: "ana", signedIn: false, data: { type: "deny", requestId: "r2" } })))
    expect(received).toEqual([JSON.stringify({ type: "deny", requestId: "r2" })])
    attached[0]!.socket.send(JSON.stringify({ type: "session", info: { id: "s1" } }))
    expect(ws.sent.at(-1)).toEqual({ type: "event", to: "ana", data: { type: "session", info: { id: "s1" } } })
    c.stop()
  })

  // Owner, 18 Nov: a stale CNW image lost histories after the sync fix. Codehouse says its protocol in its hello, and
  // says "CNW needs updating" when CNW is older (one from before the handshake sends no number), or the reverse.
  it("sends its protocol, and says which side needs updating when CNW's differs", () => {
    const key = newComputerKey()
    const logs: string[] = []
    const run = (welcome: Record<string, unknown>) => {
      const sockets: FakeWs[] = []
      const c = new CnwConnector({
        url: "https://cnw.home.arpa",
        computerId: "c1",
        privateKey: key.privateKey,
        version: "x",
        attach: () => undefined,
        log: (l) => void logs.push(l),
        createSocket: () => {
          const w = new FakeWs()
          sockets.push(w)
          return w as never
        },
      })
      c.start()
      sockets[0]!.emit("message", Buffer.from(JSON.stringify({ type: "challenge", challenge: "abc" })))
      expect(sockets[0]!.sent[0]).toMatchObject({ type: "hello", protocol: CNW_PROTOCOL })
      sockets[0]!.emit("message", Buffer.from(JSON.stringify({ type: "welcome", ...welcome })))
      c.stop()
      return c.needsUpdate
    }
    expect(run({})).toBe("cnw")
    expect(logs.join("\n")).toMatch(/CNW needs updating/)
    expect(run({ protocol: CNW_PROTOCOL })).toBeUndefined()
    expect(run({ protocol: CNW_PROTOCOL + 1 })).toBe("codehouse")
    expect(protocolGap(CNW_PROTOCOL, CNW_PROTOCOL)).toBeUndefined()
  })

  it("stops for good when CNW refuses the computer", () => {
    const key = newComputerKey()
    const sockets: FakeWs[] = []
    const c = new CnwConnector({
      url: "https://cnw.home.arpa",
      computerId: "c1",
      privateKey: key.privateKey,
      version: "x",
      attach: () => undefined,
      log: () => undefined,
      createSocket: () => {
        const w = new FakeWs()
        sockets.push(w)
        return w as never
      },
    })
    c.start()
    sockets[0]!.close(4401)
    expect(c.status).toBe("refused")
    c.stop()
  })
})
