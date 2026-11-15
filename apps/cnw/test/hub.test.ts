// O41: the hub lets in only a computer that signs its challenge with the key it paired with, passes commands to it
// with the user they came from, and its events to every tab watching; nothing reaches a computer that is not proved.
import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import { Hub, MAX_COMMANDS_A_MINUTE, type Socket } from "../src/hub.js"

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
    expect(good.sent.at(-1)).toEqual({ type: "welcome" })
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
