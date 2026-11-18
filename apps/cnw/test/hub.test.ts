// O41: the hub lets in only a computer that signs its challenge with the key it paired with, passes commands to it
// with the user they came from, and its events to every tab watching; nothing reaches a computer that is not proved.
import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import { Hub, MAX_COMMANDS_A_MINUTE, MAX_MESSAGE, PART, PROTOCOL, protocolGap, type Socket } from "../src/hub.js"

const sock = () => {
  const sent: Array<Record<string, unknown>> = []
  let closed: number | undefined
  const s: Socket = { send: (d) => void sent.push(JSON.parse(d)), close: (c) => void (closed = c) }
  return { s, sent, closed: () => closed }
}

function paired() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const computer = { id: "c1", label: "Laptop", publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"), pairedAt: "" }
  return { computer, sign: (c: string) => crypto.sign(null, Buffer.from(c), privateKey).toString("base64url") }
}

// Owner, 18 Nov: a stale CNW image lost histories after the sync fix. Each side says its protocol; on a mismatch the
// board says which side needs updating, rather than losing data quietly.
describe("the protocol handshake", () => {
  const hello = (protocol?: number) => {
    const { computer, sign } = paired()
    const hub = new Hub(() => [computer])
    const agent = sock()
    hub.agentOpened(agent.s)
    hub.agentMessage(agent.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(agent.sent[0]!.challenge as string), ...(protocol !== undefined ? { protocol } : {}) }))
    return { hub, agent }
  }

  it("tells the computer its own number, and marks a Codehouse from before the handshake as needing an update", () => {
    const old = hello()
    expect(old.agent.sent.at(-1)).toEqual({ type: "welcome", protocol: PROTOCOL })
    expect(old.hub.status()[0]).toMatchObject({ online: true, needsUpdate: "codehouse" })
    expect(hello(PROTOCOL).hub.status()[0]!.needsUpdate).toBeUndefined()
    expect(hello(PROTOCOL + 1).hub.status()[0]!.needsUpdate).toBe("cnw")
    expect(protocolGap(PROTOCOL, "2")).toBe("codehouse")
  })
})

describe("long messages in parts", () => {
  function connected() {
    const { computer, sign } = paired()
    const hub = new Hub(() => [computer])
    const tab = sock()
    hub.watch("c1", tab.s, "ana")
    const agent = sock()
    hub.agentOpened(agent.s)
    hub.agentMessage(agent.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(agent.sent[0]!.challenge as string) }))
    return { hub, tab, agent }
  }

  it("puts parts back together in order, and refuses parts out of order, too many at once, or too large", () => {
    const { hub, tab, agent } = connected()
    const whole = JSON.stringify({ type: "event", data: { type: "big", text: "x".repeat(PART * 2) } })
    const parts = [0, 1, 2].map((n) => JSON.stringify({ type: "part", id: "m1", n, of: 3, data: whole.slice(n * PART, (n + 1) * PART) }))
    for (const p of parts) hub.agentMessage(agent.s, p)
    expect((tab.sent.at(-1)!.data as { text: string }).text).toHaveLength(PART * 2)
    // Out of order.
    const a = connected()
    a.hub.agentMessage(a.agent.s, JSON.stringify({ type: "part", id: "m2", n: 1, of: 2, data: "x" }))
    expect(a.agent.closed()).toBe(1009)
    // More than the most one message may be.
    const b = connected()
    b.hub.agentMessage(b.agent.s, JSON.stringify({ type: "part", id: "m3", n: 0, of: Math.ceil(MAX_MESSAGE / PART) + 1, data: "x" }))
    expect(b.agent.closed()).toBe(1009)
    // Too many begun at once.
    const c = connected()
    for (let i = 0; i < 9; i++) c.hub.agentMessage(c.agent.s, JSON.stringify({ type: "part", id: `m${i}`, n: 0, of: 2, data: "x" }))
    expect(c.agent.closed()).toBe(1009)
  })

  it("asks a computer that comes back for each open tab's state", () => {
    const { computer, sign } = paired()
    const hub = new Hub(() => [computer])
    hub.watch("c1", sock().s, "ana")
    hub.watch("c1", sock().s, "ana")
    hub.watch("c1", sock().s, "bob")
    const agent = sock()
    hub.agentOpened(agent.s)
    hub.agentMessage(agent.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(agent.sent[0]!.challenge as string) }))
    expect(agent.sent.filter((m) => m.type === "snapshot").map((m) => m.from)).toEqual(["ana", "bob"])
  })
})

describe("the CNW hub (O41)", () => {
  it("lets in a computer only with its own signature over a fresh challenge", () => {
    const { computer, sign } = paired()
    const hub = new Hub(() => [computer])
    const bad = sock()
    hub.agentOpened(bad.s)
    expect(hub.agentMessage(bad.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign("an old challenge") }))).toBeUndefined()
    expect(bad.closed()).toBe(4401)
    const good = sock()
    hub.agentOpened(good.s)
    const challenge = good.sent[0]!.challenge as string
    expect(hub.agentMessage(good.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(challenge), version: "2.0.351" }))).toBe("c1")
    expect(good.sent.at(-1)).toMatchObject({ type: "welcome" })
    expect(hub.status()).toEqual([expect.objectContaining({ id: "c1", online: true, version: "2.0.351" })])
  })

  it("passes commands with who sent them, events to every tab, and says when the computer is offline", () => {
    const { computer, sign } = paired()
    const hub = new Hub(() => [computer])
    const tab = sock()
    hub.watch("c1", tab.s, "ana")
    expect(hub.command("c1", tab.s, JSON.stringify({ type: "approve", requestId: "r1" }))).toBe("offline")
    const agent = sock()
    hub.agentOpened(agent.s)
    hub.agentMessage(agent.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(agent.sent[0]!.challenge as string) }))
    expect(hub.command("c1", tab.s, JSON.stringify({ type: "approve", requestId: "r1" }))).toBe("sent")
    expect(agent.sent.at(-1)).toEqual({ type: "command", from: "ana", signedIn: true, data: { type: "approve", requestId: "r1" } })
    hub.agentMessage(agent.s, JSON.stringify({ type: "event", data: { type: "session_state", id: "s1" } }))
    expect(tab.sent.at(-1)).toEqual({ type: "event", data: { type: "session_state", id: "s1" } })
    const stranger = sock()
    expect(hub.command("c1", stranger.s, "{}")).toBe("refused")
    // An event the computer addressed to one user (their replies) reaches only that user's tabs.
    const bob = sock()
    hub.watch("c1", bob.s, "bob")
    const before = bob.sent.length
    hub.agentMessage(agent.s, JSON.stringify({ type: "event", to: "ana", data: { type: "reply", cmdId: "x", ok: true } }))
    expect(tab.sent.at(-1)).toEqual({ type: "event", data: { type: "reply", cmdId: "x", ok: true } })
    expect(bob.sent.slice(before).some((e) => (e.data as { cmdId?: string } | undefined)?.cmdId === "x")).toBe(false)
  })

  it("limits how fast one tab can send, and disconnects a computer you remove", () => {
    const { computer, sign } = paired()
    let now = 0
    const hub = new Hub(() => [computer], () => now)
    const agent = sock()
    hub.agentOpened(agent.s)
    hub.agentMessage(agent.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(agent.sent[0]!.challenge as string) }))
    const tab = sock()
    hub.watch("c1", tab.s, "ana")
    for (let i = 0; i < MAX_COMMANDS_A_MINUTE; i++) hub.command("c1", tab.s, "{}")
    expect(hub.command("c1", tab.s, "{}")).toBe("refused")
    now = 61_000
    expect(hub.command("c1", tab.s, "{}")).toBe("sent")
    hub.forget("c1")
    expect(agent.closed()).toBe(4403)
  })
})
