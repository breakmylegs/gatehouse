// E-077: a personal handover pack verifies; a tampered one is refused; it holds what is open, waiting and expiring.
import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import { handoverMarkdown, makeHandover, openHandover, signHandover } from "../src/handover-pack.js"

const me = crypto.generateKeyPairSync("ed25519")
const other = crypto.generateKeyPairSync("ed25519")
const pem = (k: crypto.KeyObject) => k.export({ type: "spki", format: "pem" }).toString()
const signer = (k = me) => async (b: Buffer) => ({ signature: crypto.sign(null, b, k.privateKey).toString("base64"), publicKey: pem(k.publicKey) })
const NOW = new Date("2026-11-20T09:00:00Z")
const DAY = 86_400_000

const input = () => ({
  by: "Peter",
  note: "The ACME-CORP migration is half done; carry on from the second step.",
  sessions: [{ id: "s1", project: "shop", title: "Checkout for ACME-CORP", state: "idle", mode: "default" }],
  pending: [{ id: "r1", project: "shop", tool: "Bash", risk: 75, reason: "Deploys to staging", waitingSince: NOW.toISOString() }],
  grants: [
    { id: "remember-npm-test", reason: "npm test", notAfter: NOW.getTime() + 2 * DAY },
    { id: "remember-later", reason: "later", notAfter: NOW.getTime() + 30 * DAY },
    { id: "remember-gone", reason: "gone", notAfter: NOW.getTime() - DAY },
    { id: "remember-forever", reason: "no expiry" },
  ],
  routines: [{ id: "n1", name: "Nightly checks", project: "shop", when: "02:00 every day", enabled: true }],
  redact: (s: string) => s.replace(/ACME-CORP/g, "[REDACTED]"),
  now: NOW,
})

describe("personal handover packs", () => {
  it("holds the open sessions, what waits, grants expiring within a week and routines, redacted, with a summary", () => {
    const p = makeHandover(input())
    expect(p.grants).toEqual([{ id: "remember-npm-test", reason: "npm test", expiresAt: new Date(NOW.getTime() + 2 * DAY).toISOString(), inDays: 2 }])
    expect(p.sessions[0]!.title).toBe("Checkout for [REDACTED]")
    expect(JSON.stringify(p)).not.toContain("ACME-CORP")
    expect(p.summary).toMatch(/^1 open session\(s\) across shop\.\n1 decision\(s\) waiting for a person, the riskiest at 75\.\n1 grant\(s\) expire within a week, the first 2026-11-22\.\n1 routine\(s\) on, 0 off\.\n\nThe \[REDACTED\] migration/)
    expect(handoverMarkdown(p)).toContain("- remember-npm-test, 2026-11-22 (in 2 day(s)): npm test")
  })

  it("verifies a signed pack, and refuses one changed after signing", async () => {
    const signed = await signHandover(makeHandover(input()), signer())
    const opened = openHandover(signed)
    expect(opened).toMatchObject({ ok: true, pack: { by: "Peter", kind: "codehouse-handover" }, trustedKey: false })
    expect(openHandover(signed, [pem(me.publicKey)])).toMatchObject({ ok: true, trustedKey: true })
    // One byte changed in the pack.
    const bytes = Buffer.from(signed.pack, "base64")
    bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 1
    expect(openHandover({ ...signed, pack: bytes.toString("base64") })).toMatchObject({ ok: false, why: expect.stringMatching(/changed after it was signed/) })
    // Re-signed by someone else and passed off with the original key.
    const forged = await signHandover({ ...makeHandover(input()), summary: "Nothing to do." }, signer(other))
    expect(openHandover({ ...forged, publicKey: signed.publicKey })).toMatchObject({ ok: false })
    expect(openHandover(forged, [pem(me.publicKey)])).toMatchObject({ ok: false, why: expect.stringMatching(/key you do not trust/) })
    expect(openHandover({ pack: "x" })).toMatchObject({ ok: false })
    // Signed properly, but something else: a knowledge pack is not a handover.
    const elsewise = await signHandover({ v: 1, kind: "codehouse-knowledge" } as never, signer())
    expect(openHandover(elsewise)).toMatchObject({ ok: false, why: expect.stringMatching(/not a Codehouse handover pack/) })
  })
})
