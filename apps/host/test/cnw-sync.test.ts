// O41, a faithful live copy: through the real connector and CNW's real hub, a message far over the 4 MB frame cap (a
// long session's transcript) arrives whole; after a forced drop and reconnect, a tab is given the desktop's state
// afresh, with nothing missing or shown twice; and a permission prompt withdrawn on the desktop goes in CNW too.
import crypto from "node:crypto"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import { Hub, MAX_FRAME, type Socket } from "../../cnw/src/hub.js"
import { CnwConnector, newComputerKey, PART, type VirtualSocket } from "../src/cnw/connector.js"

/** The computer's connection to CNW, in memory: what the connector sends goes to the hub, and back. */
class Link extends EventEmitter {
  readyState = 1
  frames: number[] = []
  readonly agent: Socket
  constructor(readonly hub: Hub) {
    super()
    this.agent = {
      send: (d) => setImmediate(() => this.readyState === 1 && this.emit("message", Buffer.from(d))),
      close: (code) => setImmediate(() => this.close(code)),
    }
    setImmediate(() => hub.agentOpened(this.agent))
  }
  send(text: string) {
    if (this.readyState !== 1) return
    this.frames.push(text.length)
    this.hub.agentMessage(this.agent, text)
  }
  ping() {}
  terminate() {
    this.close(1006)
  }
  close(code = 1000) {
    if (this.readyState === 3) return
    this.readyState = 3
    this.hub.agentClosed(this.agent)
    this.emit("close", code, Buffer.from(""))
  }
}

/** The desktop: its state, and every client the Host has (CNW's included), as the Host's server keeps them. */
function desktop() {
  const state = { pending: [{ request: { id: "P1" } }] as unknown[] }
  const clients = new Set<VirtualSocket>()
  return {
    state,
    attach: (s: VirtualSocket) => {
      clients.add(s)
      s.on("close", () => clients.delete(s))
      s.send(JSON.stringify({ type: "hello", sessions: [], pending: state.pending, health: {}, usage: {} }))
    },
    broadcast: (e: unknown) => {
      for (const c of clients) if (c.readyState === 1) c.send(JSON.stringify(e))
    },
  }
}

const until = async (ok: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20))
  if (!ok()) throw new Error("timed out")
}

let stop: Array<() => void> = []
afterEach(() => {
  for (const s of stop) s()
  stop = []
})

function setup() {
  const key = newComputerKey()
  const computer = { id: "c1", label: "Laptop", publicKey: key.publicKey, pairedAt: "" }
  const hub = new Hub(() => [computer])
  const links: Link[] = []
  const desk = desktop()
  const connector = new CnwConnector({
    url: "https://cnw.home.arpa",
    computerId: "c1",
    privateKey: key.privateKey,
    version: "test",
    attach: (s) => desk.attach(s),
    log: () => undefined,
    createSocket: () => {
      const l = new Link(hub)
      links.push(l)
      return l as never
    },
  })
  const tab: Array<{ type: string; data?: { type?: string; [k: string]: unknown } }> = []
  hub.watch("c1", { send: (d) => void tab.push(JSON.parse(d)), close: () => undefined }, "ana")
  connector.start()
  stop.push(() => connector.stop())
  const hellos = () => tab.filter((f) => f.data?.type === "hello")
  return { hub, links, desk, connector, tab, hellos }
}

describe("CNW shows what the desktop shows", () => {
  it("delivers a message far over the 4 MB frame cap whole, in frames each under it", async () => {
    const s = setup()
    await until(() => s.connector.status === "connected" && s.hellos().length === 1)
    const text = crypto.randomBytes(3 * 1024 * 1024).toString("hex") // 6 MB
    s.desk.broadcast({ type: "sdk_message", sessionId: "s1", message: { text } })
    await until(() => s.tab.some((f) => f.data?.type === "sdk_message"))
    const got = s.tab.find((f) => f.data?.type === "sdk_message")!.data as { message: { text: string } }
    expect(got.message.text).toBe(text)
    expect(Math.max(...s.links[0]!.frames)).toBeLessThanOrEqual(MAX_FRAME)
    expect(Math.max(...s.links[0]!.frames)).toBeLessThanOrEqual(PART + 200)
    expect(s.links[0]!.readyState).toBe(1)
  }, 30_000)

  it("after a forced drop and reconnect, gives the tab the desktop's state afresh, nothing missing or twice", async () => {
    const s = setup()
    await until(() => s.connector.status === "connected" && s.hellos().length === 1)
    s.desk.broadcast({ type: "session_event", n: 1 })
    s.links[0]!.terminate()
    // In the gap: the desktop answers the prompt and a message goes by that no CNW tab could see.
    s.desk.state.pending = []
    s.desk.broadcast({ type: "approval_resolved", id: "P1" })
    await until(() => s.connector.status === "connected" && s.hellos().length === 2)
    s.desk.broadcast({ type: "session_event", n: 2 })
    await until(() => s.tab.some((f) => f.data?.type === "session_event" && f.data.n === 2))
    // The tab's newest greeting is the desktop as it is now: no prompt waiting.
    expect(s.hellos().at(-1)!.data!.pending).toEqual(s.desk.state.pending)
    const events = s.tab.filter((f) => f.data?.type === "session_event").map((f) => f.data!.n)
    expect(events).toEqual([1, 2])
    // The page was told the computer went and came back (the tab opened before the computer connected), so it shows
    // it is catching up meanwhile.
    expect(s.tab.filter((f) => f.type === "computer_online").map((f) => (f as unknown as { online: boolean }).online)).toEqual([false, true, false, true])
  }, 30_000)

  it("removes in CNW a permission prompt withdrawn on the desktop, even while the connection was down", async () => {
    const s = setup()
    await until(() => s.connector.status === "connected" && s.hellos().length === 1)
    expect(s.hellos()[0]!.data!.pending).toHaveLength(1)
    // Withdrawn on the desktop (the Grep stopped) while CNW could not hear it.
    s.links[0]!.terminate()
    s.desk.state.pending = []
    s.desk.broadcast({ type: "approval_resolved", id: "P1", sessionId: "s1", resolution: { outcome: "deny", summary: "Stopped", at: "" } })
    expect(s.tab.some((f) => f.data?.type === "approval_resolved")).toBe(false)
    // Back: the tab's state no longer has the prompt.
    await until(() => s.hellos().length === 2)
    expect(s.hellos().at(-1)!.data!.pending).toEqual([])
  }, 30_000)
})
