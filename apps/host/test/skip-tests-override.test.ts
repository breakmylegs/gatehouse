// C-002: a release skips its tests only with the owner's override, signed with the release key, for exactly that
// version, and not expired.
import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  checkSkipOverride,
  makeSkipOverride,
  MAX_OVERRIDE_MS,
} from "../../../scripts/skip-tests-override.js"

const keys = crypto.generateKeyPairSync("ed25519")
const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString()
const other = crypto.generateKeyPairSync("ed25519")
const otherPrivate = other.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const NOW = Date.parse("2026-11-09T12:00:00Z")

describe("skipping a release's tests (C-002)", () => {
  it("is allowed by a signed override for exactly this version, while it lasts", () => {
    const o = makeSkipOverride(privatePem, "2.0.150", "the gate just passed on this commit", NOW)
    expect(checkSkipOverride(o, "2.0.150", [publicPem], NOW)).toMatchObject({ ok: true })
    expect(checkSkipOverride(o, "2.0.151", [publicPem], NOW)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not 2\.0\.151/),
    })
    expect(checkSkipOverride(o, "2.0.150", [publicPem], NOW + MAX_OVERRIDE_MS + 1)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/expired/),
    })
  })

  it("is refused without an override, with one changed after signing, or signed by another key", () => {
    expect(checkSkipOverride(undefined, "2.0.150", [publicPem], NOW)).toMatchObject({ ok: false })
    const o = makeSkipOverride(privatePem, "2.0.150", "x", NOW)
    expect(
      checkSkipOverride({ ...o, version: "2.0.151" }, "2.0.151", [publicPem], NOW),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not signed/),
    })
    expect(
      checkSkipOverride(
        { ...o, expiresAt: new Date(NOW + 1000).toISOString() },
        "2.0.150",
        [publicPem],
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/not signed/) })
    expect(
      checkSkipOverride(
        makeSkipOverride(otherPrivate, "2.0.150", "x", NOW),
        "2.0.150",
        [publicPem],
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/not signed/) })
    expect(() => makeSkipOverride(privatePem, "2.0.150", "  ", NOW)).toThrow(/why/)
  })
})
