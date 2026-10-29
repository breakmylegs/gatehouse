/**
 * release.json: what a release contains, signed with JCVC's release key (Ed25519). The updater trusts nothing it
 * downloads until the signature checks against a key built into this version, and then trusts each archive only
 * when its size and sha256 match what the signed manifest says.
 */
import crypto from "node:crypto"
import { z } from "zod"
import { PART_NAMES } from "./tree.js"
import { parseVersion } from "./version.js"

/** A manifest with a higher format needs the installer: this version would not know how to apply it. */
export const MANIFEST_FORMAT = 1

/**
 * Public keys whose signature on release.json is trusted. The private key is the GitHub Actions secret
 * JCVC_RELEASE_KEY. To change keys, ship a release signed with the old key that lists both, then drop the old one.
 */
export const RELEASE_KEYS: readonly string[] = [
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA4hHePojIPLyz/XfXlXpO08RV/gTjRGzPNfYjar7SHbM=\n-----END PUBLIC KEY-----\n",
]

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/)

const Part = z
  .object({
    name: z.enum(PART_NAMES),
    tree: Hex64,
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    /** Only in a published release: the archive to download for this part. */
    archive: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.zip$/)
      .optional(),
    size: z.number().int().positive().max(4_000_000_000).optional(),
    sha256: Hex64.optional(),
  })
  .loose()

export const ReleaseManifest = z
  .object({
    format: z.number().int().positive(),
    product: z.literal("jcvc"),
    version: z.string().refine((v) => parseVersion(v) !== undefined, "not a JCVC version"),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    publishedAt: z.string().max(40).optional(),
    notes: z.string().max(50_000).default(""),
    parts: z
      .array(Part)
      .refine(
        (ps) => PART_NAMES.every((n) => ps.filter((p) => p.name === n).length === 1),
        "a release has each part exactly once",
      ),
  })
  .loose()
export type ReleaseManifest = z.infer<typeof ReleaseManifest>
export type ReleasePart = ReleaseManifest["parts"][number]

export type Verified = { ok: true; manifest: ReleaseManifest } | { ok: false; error: string }

/** Checks the signature over the exact bytes, then the shape. Only a published, downloadable release passes. */
export function verifyRelease(
  bytes: Buffer,
  signature: string,
  keys: readonly string[] = RELEASE_KEYS,
): Verified {
  const sig = Buffer.from(signature.trim(), "base64")
  const signed =
    sig.length === 64 &&
    keys.some((pem) => {
      try {
        return crypto.verify(null, bytes, crypto.createPublicKey(pem), sig)
      } catch {
        return false
      }
    })
  if (!signed)
    return {
      ok: false,
      error: "The update is not signed with JCVC's release key, so it was refused.",
    }
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString("utf8"))
  } catch {
    return { ok: false, error: "The update's description could not be read." }
  }
  const parsed = ReleaseManifest.safeParse(raw)
  if (!parsed.success)
    return {
      ok: false,
      error: `The update's description is not valid: ${parsed.error.issues[0]?.message}`,
    }
  const m = parsed.data
  if (m.format > MANIFEST_FORMAT)
    return {
      ok: false,
      error: `Version ${m.version} needs the installer: it changes how JCVC is laid out. Download JCVC-Setup.exe from the release page.`,
    }
  if (m.parts.some((p) => !p.archive || !p.size || !p.sha256))
    return { ok: false, error: "The update's description is missing a download." }
  return { ok: true, manifest: m }
}

/** Signs release.json for the release script. The key is PKCS#8 PEM (Ed25519). */
export function signRelease(bytes: Buffer, privatePem: string): string {
  return crypto.sign(null, bytes, crypto.createPrivateKey(privatePem)).toString("base64")
}
