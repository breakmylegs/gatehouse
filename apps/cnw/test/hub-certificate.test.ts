// ADR 0020: a computer that refused CNW's certificate says so, signed, and the board shows "certificate refused by this
// computer" rather than "never connected". The refusal is signed over "cnw-refused:" and the challenge, so it signs no
// one in, and a hello's signature is not a refusal; the welcome carries caddy's root for an old pairing to move to.
import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import { Hub, type Socket } from "../src/hub.js"

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

const ROOT = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"

describe("a computer that refused CNW's certificate (ADR 0020)", () => {
  it("is shown as refusing, only when it signed the refusal, and is cleared when it connects", () => {
    const { computer, sign } = paired()
    let now = 1000
    const hub = new Hub(() => [computer], () => now, () => ROOT)
    const a = sock()
    hub.agentOpened(a.s)
    const challenge = a.sent[0]!.challenge as string
    expect(hub.agentMessage(a.s, JSON.stringify({ type: "refused", computer: "c1", reason: "certificate", signature: sign(`cnw-refused:${challenge}`) }))).toBeUndefined()
    expect(a.closed()).toBe(4000)
    expect(hub.status()[0]).toMatchObject({ online: false, refused: { at: 1000, reason: "certificate" } })
    now = 2000
    const b = sock()
    hub.agentOpened(b.s)
    expect(hub.agentMessage(b.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(b.sent[0]!.challenge as string) }))).toBe("c1")
    expect(b.sent.at(-1)).toMatchObject({ type: "welcome", ca: ROOT })
    expect(hub.status()[0]).toMatchObject({ online: true })
    expect(hub.status()[0]).not.toHaveProperty("refused")
    // It connected, so the refusal is over: a later drop shows it offline, not refusing.
    hub.agentClosed(b.s)
    expect(hub.status()[0]).toMatchObject({ online: false })
    expect(hub.status()[0]).not.toHaveProperty("refused")
  })

  it("does not take a refusal signed by someone else, nor a hello's signature as one, nor a refusal's as a hello", () => {
    const { computer, sign } = paired()
    const stranger = paired()
    const hub = new Hub(() => [computer])
    const a = sock()
    hub.agentOpened(a.s)
    const c = a.sent[0]!.challenge as string
    hub.agentMessage(a.s, JSON.stringify({ type: "refused", computer: "c1", signature: stranger.sign(`cnw-refused:${c}`) }))
    expect(a.closed()).toBe(4401)
    const b = sock()
    hub.agentOpened(b.s)
    hub.agentMessage(b.s, JSON.stringify({ type: "refused", computer: "c1", signature: sign(b.sent[0]!.challenge as string) }))
    expect(b.closed()).toBe(4401)
    const d = sock()
    hub.agentOpened(d.s)
    expect(hub.agentMessage(d.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(`cnw-refused:${d.sent[0]!.challenge as string}`) }))).toBeUndefined()
    expect(d.closed()).toBe(4401)
    expect(hub.status()[0]).not.toHaveProperty("refused")
    expect(hub.status()[0]!.online).toBe(false)
  })

  it("sends no root in the welcome when there is none (a public certificate)", () => {
    const { computer, sign } = paired()
    const hub = new Hub(() => [computer])
    const a = sock()
    hub.agentOpened(a.s)
    hub.agentMessage(a.s, JSON.stringify({ type: "hello", computer: "c1", signature: sign(a.sent[0]!.challenge as string) }))
    expect(a.sent.at(-1)).not.toHaveProperty("ca")
  })
})
