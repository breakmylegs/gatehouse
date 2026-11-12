// D-029b, audit anchors signed with the phone's passkey: the phone's signed anchor envelope is accepted like any phone
// decision (invariant 8), kept with its assertion, and both verifiers check it with the phone's key; a changed anchor or
// a record rewritten after it fails both.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { AuditWriter, verifyAudit, type AuditEntry } from "@gatehouse/shared/audit"
import type { SignedDecision } from "@gatehouse/shared/relay-protocol"
import { FakeAuthenticator } from "../../../packages/shared/test/support/fake-authenticator.js"
import { AnchorService } from "../src/anchors.js"
import { REPO_ROOT } from "../src/bootstrap.js"
import { envelopeChallenge, verifyPhoneDecision, type PinnedPhone } from "../src/relay/verify.js"
import { TimelineSigner } from "../src/timeline-export.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-phanchor-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const VERIFIER = path.join(REPO_ROOT, "scripts", "verify-audit.ps1")
const ps = (dir: string): boolean => {
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", VERIFIER, "-Dir", dir], { windowsHide: true, stdio: "ignore", timeout: 120_000 })
    return true
  } catch {
    return false
  }
}
const RP = "gh.example.test"
const ORIGIN = "https://gh.example.test"
const entry = (i: number): AuditEntry => ({
  session: "s1",
  event: "human_decision",
  channel: "desktop",
  tool: "Bash",
  input: { command: `step ${i}` },
  verdict: { outcome: "allow", ruleId: "no-rule", reason: "ok", risk: 10, decidedBy: "human-desktop", policyHash: "a".repeat(64) },
  latencyMs: 0,
})

describe("audit anchors signed on the phone (D-029b)", () => {
  it("accepts the phone's signed anchor, keeps it, and both verifiers check it", async () => {
    const auditDir = path.join(root, "audit")
    const anchorsDir = path.join(root, "anchors")
    const w = new AuditWriter({ dir: auditDir, redact: (v) => v })
    for (let i = 0; i < 3; i++) await w.append(entry(i))
    const recorded: unknown[] = []
    const service = new AnchorService({
      dir: anchorsDir,
      auditDir,
      signer: new TimelineSigner({ dir: path.join(root, "data"), sealer: () => ({ protect: async (b: Uint8Array) => Buffer.from(b), unprotect: async (b: Uint8Array) => Buffer.from(b) }), file: "anchor-key.sealed" }),
      audit: { record: async (e) => (recorded.push(e), true) },
      log: () => undefined,
      git: async () => "",
    })
    const head = service.head()!
    const auth = await FakeAuthenticator.create()
    const phone: PinnedPhone = { id: "phone-1", name: "iPhone", credentialId: auth.credentialId, credentialPublicKey: auth.coseKey.toString("base64url"), counter: 0, ecdhPublicKey: "x", pairedAt: new Date().toISOString() }
    const now = Date.now()
    const envelope = {
      v: 1 as const,
      type: "anchor" as const,
      anchor: head,
      nonce: "anchor-nonce-0001",
      deviceId: "phone-1",
      issuedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }
    const assertion = await auth.assert({ challenge: await envelopeChallenge(envelope), rpId: RP, origin: ORIGIN })
    const signed: SignedDecision = { envelope, assertion: assertion as unknown as Record<string, unknown> }
    const v = await verifyPhoneDecision({ signed, phone, pending: () => undefined, nonceUsed: () => false, now, rpId: RP, origin: ORIGIN })
    expect(v).toMatchObject({ ok: true, action: { type: "anchor", seq: head.seq, hash: head.hash } })
    // An anchor that also names a session is refused.
    const odd = { ...envelope, sessionId: "s1" }
    const oddSigned: SignedDecision = { envelope: odd, assertion: (await auth.assert({ challenge: await envelopeChallenge(odd), rpId: RP, origin: ORIGIN })) as unknown as Record<string, unknown> }
    expect(await verifyPhoneDecision({ signed: oddSigned, phone, pending: () => undefined, nonceUsed: () => false, now, rpId: RP, origin: ORIGIN })).toMatchObject({ ok: false })

    const r = (assertion as { response: { authenticatorData: string; clientDataJSON: string; signature: string } }).response
    const kept = await service.phone({ phoneId: "phone-1", phoneName: "iPhone", credentialPublicKey: phone.credentialPublicKey, envelope: envelope as never, assertion: r })
    expect(kept).toMatchObject({ signer: "phone", strength: "passkey", seq: head.seq })
    expect(recorded[0]).toMatchObject({ event: "anchor_signed", channel: "phone", verdict: { decidedBy: "human-phone" } })
    expect(verifyAudit(auditDir, { anchorsDir })).toMatchObject({ ok: true, anchors: 1 })
    expect(ps(auditDir)).toBe(true)
    // A record the phone did not see with that hash is refused.
    await expect(service.phone({ phoneId: "phone-1", phoneName: "iPhone", credentialPublicKey: phone.credentialPublicKey, envelope: { ...envelope, anchor: { seq: head.seq, hash: "0".repeat(64) } } as never, assertion: r })).rejects.toThrow()

    // Changing the anchor's envelope breaks the passkey's signature, in both verifiers.
    const file = path.join(anchorsDir, fs.readdirSync(anchorsDir).find((f) => f.endsWith("-p.json"))!)
    const saved = fs.readFileSync(file, "utf8")
    fs.writeFileSync(file, saved.replace('"nonce": "anchor-nonce-0001"', '"nonce": "anchor-nonce-0002"'))
    expect(verifyAudit(auditDir, { anchorsDir }).problems.map((p) => p.reason)).toEqual(["the passkey's signature does not verify, so the anchor was changed"])
    expect(ps(auditDir)).toBe(false)
  })
})
