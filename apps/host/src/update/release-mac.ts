/**
 * Mac fork (owner, 18 Nov: the Mac in-app updater): what a Mac release is. Its own releases, never GitHub's Latest
 * (Windows copies find theirs at releases/latest), signed with a Mac key of its own, in parts like Windows' so an update
 * downloads only what changed. Kept apart from manifest.ts and tree.ts so Windows' releases are exactly as they were.
 *
 * The names below are what every installed Mac copy finds its updates by. Like UPDATE_FILE and PRODUCT on Windows they
 * never change, whatever the app is called (owner, 2 Nov: "We cant have a breaking change ever").
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { MANIFEST_FORMAT, signedBy } from "./manifest.js"
import { hashFile, mapLimit, type PartTree } from "./tree.js"
import { compareVersions } from "./version.js"

export const MAC_PRODUCT = "gatehouse-mac"
/** The newest release's description and its signature, on the release tagged MAC_CHANNEL_TAG. */
export const MAC_UPDATE_FILE = "update-mac.json"
export const MAC_UPDATE_SIGNATURE = "update-mac.sig"
/** A release that is never Latest and holds only the newest MAC_UPDATE_FILE, refreshed by each Mac release. */
export const MAC_CHANNEL_TAG = "mac-channel"
/** A Mac release's own tag: 2.0.444+mac.3 is mac-v2.0.444-mac.3 (a + is awkward in a release's address). */
export const macTag = (version: string): string => `mac-v${version.replace("+", "-")}`

/**
 * Public keys whose signature on a Mac release is trusted, for Mac updates only. The private key is made on the Mac
 * that publishes (npm run release:mac -- --new-key) and stays there. To change keys, ship a release signed with the old
 * key that lists both, then drop the old one. None yet: until there is one, every Mac release is refused.
 */
export const MAC_RELEASE_KEYS: readonly string[] = []

/** Codehouse.app in four parts. Paths are inside the bundle, from Contents/. */
export const MAC_PART_NAMES = ["program", "app", "modules", "runtime"] as const
export type MacPartName = (typeof MAC_PART_NAMES)[number]
/** Large parts an update copies from the installed app when their hash is unchanged. */
export const MAC_REUSABLE: readonly MacPartName[] = ["modules", "runtime"]
export const MAC_PART_DIRS: Record<Exclude<MacPartName, "program">, string> = {
  runtime: "Contents/Resources/runtime",
  modules: "Contents/Resources/app/node_modules",
  app: "Contents/Resources/app",
}

/** The part a path inside Codehouse.app belongs to: the program is the window, Info.plist, icons and the seal. */
export function macPartOf(rel: string): MacPartName | undefined {
  if (rel.startsWith(`${MAC_PART_DIRS.runtime}/`)) return "runtime"
  if (rel.startsWith(`${MAC_PART_DIRS.modules}/`)) return "modules"
  if (rel.startsWith(`${MAC_PART_DIRS.app}/`)) return "app"
  if (rel.startsWith("Contents/")) return "program"
  return undefined
}

/**
 * Every file and link in the app, as forward-slash paths, sorted. A link is listed as itself and never followed: on a
 * Mac the workspace packages are relative links (scripts/package.mjs), which an update must carry as they are.
 */
export async function listMacFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink() || e.isFile()) out.push(path.relative(root, p).split(path.sep).join("/"))
      else if (e.isDirectory()) await walk(p)
    }
  }
  if (fs.existsSync(root)) await walk(root)
  return out.sort()
}

/**
 * sha256 over "path NUL kind hash LF" in sorted order: a link by its target, a file by its content and whether it is
 * executable, so an update that loses either does not match its signed hash.
 */
export async function macTreeHash(root: string, rels: string[]): Promise<string> {
  const sorted = [...rels].sort()
  const entries = await mapLimit(sorted, 16, async (rel) => {
    const full = path.join(root, rel)
    const st = await fs.promises.lstat(full)
    if (st.isSymbolicLink())
      return `l:${crypto.createHash("sha256").update(await fs.promises.readlink(full)).digest("hex")}`
    return `${st.mode & 0o111 ? "x" : "f"}:${await hashFile(full)}`
  })
  const h = crypto.createHash("sha256")
  sorted.forEach((rel, i) => h.update(`${rel}\0${entries[i]}\n`))
  return h.digest("hex")
}

/** Each part's tree hash, entry count and size (a link counts its target's length, as its zip entry does). */
export async function macPartTrees(root: string): Promise<Record<MacPartName, PartTree>> {
  const all = await listMacFiles(root)
  const out = {} as Record<MacPartName, PartTree>
  for (const name of MAC_PART_NAMES) {
    const rels = all.filter((r) => macPartOf(r) === name)
    let bytes = 0
    for (const r of rels) {
      const st = fs.lstatSync(path.join(root, r))
      bytes += st.isSymbolicLink() ? Buffer.byteLength(fs.readlinkSync(path.join(root, r))) : st.size
    }
    out[name] = { tree: await macTreeHash(root, rels), files: rels.length, bytes }
  }
  return out
}

/**
 * A Mac version: the release it is built from and the Mac commits since, 2.0.444+mac.3, or a build with changes not
 * committed, 2.0.444+mac.3.dev (scripts/package-mac.mjs). Windows' compareVersions ignores the +mac part.
 */
const MAC_SHAPE = /^(\d{1,6}\.\d{1,6}\.\d{1,9})\+mac\.(\d{1,6})(\.dev)?$/
export const isMacVersion = (v: string): boolean => MAC_SHAPE.test(v)

/** Below zero when a is older. Its release first, then the Mac commits; a .dev build sorts before its own number. */
export function compareMacVersions(a: string, b: string): number {
  const x = MAC_SHAPE.exec(a)
  const y = MAC_SHAPE.exec(b)
  if (!x || !y) throw new Error(`Not a Mac version: ${!x ? a : b}`)
  return compareVersions(x[1]!, y[1]!) || Number(x[2]) - Number(y[2]) || (y[3] ? 1 : 0) - (x[3] ? 1 : 0)
}

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const MacPart = z
  .object({
    name: z.enum(MAC_PART_NAMES),
    tree: Hex64,
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    archive: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.zip$/),
    size: z.number().int().positive().max(4_000_000_000),
    sha256: Hex64,
  })
  .loose()

export const MacManifest = z
  .object({
    format: z.number().int().positive(),
    product: z.literal(MAC_PRODUCT),
    version: z.string().refine((v) => !v.endsWith(".dev") && isMacVersion(v), "not a Mac release version"),
    /** The processor it is built for, as Node names it: an app for another one would not start. */
    arch: z.enum(["arm64", "x64"]),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    publishedAt: z.string().max(40).optional(),
    notes: z.string().max(50_000).default(""),
    parts: z
      .array(MacPart)
      .refine(
        (ps) => MAC_PART_NAMES.every((n) => ps.filter((p) => p.name === n).length === 1),
        "a release has each part exactly once",
      ),
  })
  .loose()
export type MacManifest = z.infer<typeof MacManifest>
export type MacPart = MacManifest["parts"][number]

export type MacVerified = { ok: true; manifest: MacManifest } | { ok: false; error: string }

/** The signature over the exact bytes, then the shape, then that it is for this Mac's processor. */
export function verifyMacRelease(
  bytes: Buffer,
  signature: string,
  keys: readonly string[] = MAC_RELEASE_KEYS,
  arch: string = process.arch,
): MacVerified {
  if (!signedBy(bytes, signature, keys))
    return { ok: false, error: "The update is not signed with Codehouse's Mac release key, so it was refused." }
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString("utf8"))
  } catch {
    return { ok: false, error: "The update's description could not be read." }
  }
  const parsed = MacManifest.safeParse(raw)
  if (!parsed.success)
    return { ok: false, error: `The update's description is not valid: ${parsed.error.issues[0]?.message}` }
  const m = parsed.data
  if (m.format > MANIFEST_FORMAT)
    return { ok: false, error: `Version ${m.version} needs a new Codehouse.app installed by hand: it changes how the app is laid out.` }
  if (m.arch !== arch)
    return { ok: false, error: `Version ${m.version} is built for ${m.arch} Macs, and this one is ${arch}.` }
  return { ok: true, manifest: m }
}
