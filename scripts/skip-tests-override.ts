// C-002: a release skips its tests only with the owner's signed override for exactly that version. The override is a
// small JSON file beside the release key, signed with the release key (Ed25519), valid for one version and until it
// expires (at most a day). Its use is recorded in Codehouse's audit log before the release goes on; if it cannot be
// recorded, the release stops.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export interface SkipOverride {
  version: string
  reason: string
  expiresAt: string
  /** Base64 Ed25519 signature over the canonical body (version, reason, expiresAt). */
  signature: string
}

/** The longest an override may last. */
export const MAX_OVERRIDE_MS = 24 * 60 * 60_000

export const overridePath = () =>
  process.env.CODEHOUSE_SKIP_TESTS_FILE ??
  path.join(process.env.USERPROFILE ?? "", ".codehouse-release", "skip-tests.json")

const body = (o: Pick<SkipOverride, "version" | "reason" | "expiresAt">) =>
  Buffer.from(
    JSON.stringify({ version: o.version, reason: o.reason, expiresAt: o.expiresAt }),
    "utf8",
  )

/** Makes an override for one version, signed with the release key. */
export function makeSkipOverride(
  privateKeyPem: string,
  version: string,
  reason: string,
  now = Date.now(),
  lifeMs = MAX_OVERRIDE_MS,
): SkipOverride {
  if (!reason.trim()) throw new Error("Say why the tests are skipped.")
  const o = {
    version,
    reason: reason.trim().slice(0, 300),
    expiresAt: new Date(now + Math.min(lifeMs, MAX_OVERRIDE_MS)).toISOString(),
  }
  const signature = crypto
    .sign(null, body(o), crypto.createPrivateKey(privateKeyPem))
    .toString("base64")
  return { ...o, signature }
}

/** Whether an override lets this version skip its tests, and why not when it does not. */
export function checkSkipOverride(
  raw: unknown,
  version: string,
  publicKeys: readonly string[],
  now = Date.now(),
): { ok: true; override: SkipOverride } | { ok: false; reason: string } {
  const o = raw as Partial<SkipOverride> | undefined
  if (!o || typeof o !== "object") return { ok: false, reason: "There is no override." }
  if (
    typeof o.version !== "string" ||
    typeof o.reason !== "string" ||
    typeof o.expiresAt !== "string" ||
    typeof o.signature !== "string"
  )
    return { ok: false, reason: "The override is not in the expected shape." }
  if (o.version !== version)
    return { ok: false, reason: `The override is for ${o.version}, not ${version}.` }
  const expires = Date.parse(o.expiresAt)
  if (Number.isNaN(expires) || expires <= now)
    return { ok: false, reason: "The override has expired." }
  if (expires - now > MAX_OVERRIDE_MS) return { ok: false, reason: "The override lasts too long." }
  const sig = Buffer.from(o.signature, "base64")
  const signed =
    sig.length === 64 &&
    publicKeys.some((pem) => {
      try {
        return crypto.verify(null, body(o as SkipOverride), crypto.createPublicKey(pem), sig)
      } catch {
        return false
      }
    })
  if (!signed) return { ok: false, reason: "The override is not signed with the release key." }
  return { ok: true, override: o as SkipOverride }
}

/** Reads the override file, or undefined when there is none or it cannot be read. */
export function readSkipOverride(file = overridePath()): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}
