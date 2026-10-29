/**
 * Making a release from a packaged JCVC folder: stamp it with its version and part hashes, zip each part, describe
 * them in release.json and sign it. Used by scripts/release.ts (npm run release) and by the tests,
 * so what is published and what the updater checks are made by the same code.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { MANIFEST_FORMAT, signRelease, type ReleaseManifest } from "./manifest.js"
import {
  hashFile,
  listFiles,
  MANIFEST_FILE,
  PART_NAMES,
  partOf,
  partTrees,
  SIGNATURE_FILE,
} from "./tree.js"
import { parseVersion } from "./version.js"
import { writeZip } from "./zip.js"

/** Writes release.json into a packaged folder: its version and part hashes, no downloads. */
export async function stampInstall(
  dir: string,
  o: { version: string; commit?: string },
): Promise<void> {
  if (!parseVersion(o.version)) throw new Error(`${o.version} is not a JCVC version`)
  const trees = await partTrees(dir)
  const manifest = {
    format: MANIFEST_FORMAT,
    product: "jcvc",
    version: o.version,
    ...(o.commit ? { commit: o.commit } : {}),
    notes: "",
    parts: PART_NAMES.map((name) => ({ name, ...trees[name] })),
  }
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n")
}

export interface MadeRelease {
  manifest: ReleaseManifest
  /** Every file to upload to the GitHub release, as absolute paths. */
  files: string[]
}

/** Zips each part of `dir` into `out`, writes release.json and release.sig there. */
export async function makeRelease(o: {
  dir: string
  out: string
  version: string
  notes: string
  commit?: string
  privateKeyPem: string
}): Promise<MadeRelease> {
  if (!parseVersion(o.version) || o.version.includes("+"))
    throw new Error(`${o.version} cannot be published: a release version is major.minor.patch`)
  fs.mkdirSync(o.out, { recursive: true })
  await stampInstall(o.dir, { version: o.version, ...(o.commit ? { commit: o.commit } : {}) })
  const trees = await partTrees(o.dir)
  const all = await listFiles(o.dir)
  const parts: ReleaseManifest["parts"] = []
  const files: string[] = []
  for (const name of PART_NAMES) {
    const rels = all.filter((r) => partOf(r) === name)
    if (rels.length === 0)
      throw new Error(`The ${name} part is empty: is ${o.dir} a packaged JCVC folder?`)
    const archive = `jcvc-${o.version}-${name}.zip`
    const zip = path.join(o.out, archive)
    fs.rmSync(zip, { force: true })
    // Only the part's own files go in, with no folder entries, so nothing from another part can.
    await writeZip(zip, o.dir, rels)
    parts.push({
      name,
      ...trees[name],
      archive,
      size: fs.statSync(zip).size,
      sha256: await hashFile(zip),
    })
    files.push(zip)
  }
  const manifest: ReleaseManifest = {
    format: MANIFEST_FORMAT,
    product: "jcvc",
    version: o.version,
    ...(o.commit ? { commit: o.commit } : {}),
    publishedAt: new Date().toISOString(),
    notes: o.notes.slice(0, 50_000),
    parts,
  }
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8")
  fs.writeFileSync(path.join(o.out, MANIFEST_FILE), bytes)
  fs.writeFileSync(path.join(o.out, SIGNATURE_FILE), signRelease(bytes, o.privateKeyPem))
  files.push(path.join(o.out, MANIFEST_FILE), path.join(o.out, SIGNATURE_FILE))
  return { manifest, files }
}

/** A fresh Ed25519 key pair, PEM, for tests and for setting up a release key. */
export function newReleaseKey(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }
}
