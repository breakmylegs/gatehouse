/**
 * Making a release from a packaged Codehouse folder: stamp it with its version and part hashes, zip each part, describe
 * them in update.json and sign it. Used by scripts/release.ts (npm run release) and by the tests,
 * so what is published and what the updater checks are made by the same code.
 *
 * Installs made before a rename read their updates under other names and another product id, and start programs by
 * their old names. Each such route gets its own signed description in its own format, and an app part with copies of
 * the programs under the names that install starts, plus MOVE_OVER_FILE so the version it arrives at finishes the
 * move into its own folder with the installer. The large parts are shared. The routes themselves (product ids and
 * program names) are kept out of the repository (scripts/release.ts).
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { MANIFEST_FORMAT, PRODUCT, signRelease, type ReleaseManifest } from "./manifest.js"
import {
  hashFile,
  listFiles,
  MANIFEST_FILE,
  MOVE_OVER_FILE,
  PART_NAMES,
  partOf,
  partTrees,
  STAGED_MARKER,
  UPDATE_FILE,
  UPDATE_SIGNATURE,
} from "./tree.js"
import { parseVersion } from "./version.js"
import { writeZip } from "./zip.js"

/** An update route for installs made before a rename. */
export interface LegacyRoute {
  /** The description and signature file names that install reads from the newest release. */
  manifest: string
  signature: string
  /** The product id that install accepts. */
  product: string
  /** For a program in the package, the other names to ship copies of it under. */
  aliases: Record<string, string[]>
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

/** Checks a route before anything is written, so a mistake in it cannot overwrite another release file. */
export function checkRoute(r: LegacyRoute): void {
  const reserved = [UPDATE_FILE, UPDATE_SIGNATURE, MOVE_OVER_FILE, STAGED_MARKER]
  for (const n of [r.manifest, r.signature])
    if (!SAFE_NAME.test(n) || reserved.includes(n))
      throw new Error(`An update route cannot be published as ${n}.`)
  if (r.manifest === r.signature)
    throw new Error("A route's description and signature need two names.")
  if (r.product === PRODUCT || !/^[a-z0-9-]{1,40}$/.test(r.product))
    throw new Error(`An update route cannot use the product id ${r.product}.`)
  for (const [from, names] of Object.entries(r.aliases))
    for (const n of [from, ...names])
      if (!SAFE_NAME.test(n) || !n.toLowerCase().endsWith(".exe") || n.includes("/"))
        throw new Error(`${n} is not a program name a route can copy.`)
}

/** Writes release.json into a packaged folder: its version and part hashes, no downloads. */
export async function stampInstall(
  dir: string,
  o: { version: string; commit?: string },
): Promise<void> {
  if (!parseVersion(o.version)) throw new Error(`${o.version} is not a Codehouse version`)
  const trees = await partTrees(dir)
  const manifest = {
    format: MANIFEST_FORMAT,
    product: PRODUCT,
    version: o.version,
    ...(o.commit ? { commit: o.commit } : {}),
    notes: "",
    parts: PART_NAMES.map((name) => ({ name, ...trees[name] })),
  }
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n")
}

export interface MadeRelease {
  manifest: ReleaseManifest
  /** The description each old route publishes, in the same order as the routes. */
  routes: Array<ReleaseManifest & { product: string }>
  /** Every file to upload to the GitHub release, as absolute paths. */
  files: string[]
}

/**
 * Zips each part of `dir` into `out`, writes update.json and update.sig there, and for each old route its own
 * description, signature and app part.
 */
export async function makeRelease(o: {
  dir: string
  out: string
  version: string
  notes: string
  commit?: string
  privateKeyPem: string
  /** Codehouse-Setup.exe of this version: named in every description, for the move-over. */
  installer?: string
  routes?: LegacyRoute[]
}): Promise<MadeRelease> {
  if (!parseVersion(o.version) || o.version.includes("+"))
    throw new Error(`${o.version} cannot be published: a release version is major.minor.patch`)
  for (const r of o.routes ?? []) checkRoute(r)
  const names = (o.routes ?? []).flatMap((r) => [r.manifest, r.signature])
  if (new Set(names).size !== names.length) throw new Error("Two update routes share a file name.")
  fs.mkdirSync(o.out, { recursive: true })
  await stampInstall(o.dir, { version: o.version, ...(o.commit ? { commit: o.commit } : {}) })
  const trees = await partTrees(o.dir)
  const all = await listFiles(o.dir)
  const parts: ReleaseManifest["parts"] = []
  const files: string[] = []
  for (const name of PART_NAMES) {
    const rels = all.filter((r) => partOf(r) === name)
    if (rels.length === 0)
      throw new Error(`The ${name} part is empty: is ${o.dir} a packaged Codehouse folder?`)
    const archive = `codeh-${o.version}-${name}.zip`
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
  const installer = o.installer
    ? {
        name: path.basename(o.installer),
        size: fs.statSync(o.installer).size,
        sha256: await hashFile(o.installer),
      }
    : undefined
  const describe = (product: string, ps: ReleaseManifest["parts"]) => ({
    format: MANIFEST_FORMAT,
    product,
    version: o.version,
    ...(o.commit ? { commit: o.commit } : {}),
    publishedAt: new Date().toISOString(),
    notes: o.notes.slice(0, 50_000),
    ...(installer ? { installer } : {}),
    parts: ps,
  })
  const write = (manifest: object, file: string, sig: string) => {
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8")
    fs.writeFileSync(path.join(o.out, file), bytes)
    fs.writeFileSync(path.join(o.out, sig), signRelease(bytes, o.privateKeyPem))
    files.push(path.join(o.out, file), path.join(o.out, sig))
  }
  const manifest = describe(PRODUCT, parts) as ReleaseManifest
  write(manifest, UPDATE_FILE, UPDATE_SIGNATURE)

  const routes: MadeRelease["routes"] = []
  for (const [i, r] of (o.routes ?? []).entries()) {
    const app = await routeAppPart(o, r, i + 1, all)
    files.push(app.zip)
    const ps = parts.map((p) => (p.name === "app" ? app.part : p))
    const m = describe(r.product, ps) as ReleaseManifest
    write(m, r.manifest, r.signature)
    routes.push(m)
  }
  return { manifest, routes, files }
}

/**
 * The app part for an old route: the package's app files, a copy of each program under each name that route starts,
 * and MOVE_OVER_FILE. Built in a folder of its own beside the release files, then removed.
 */
async function routeAppPart(
  o: { dir: string; out: string; version: string },
  r: LegacyRoute,
  n: number,
  all: string[],
): Promise<{ zip: string; part: ReleaseManifest["parts"][number] }> {
  const work = path.join(o.out, `.route-${n}`)
  fs.rmSync(work, { recursive: true, force: true })
  try {
    const rels = all.filter((f) => partOf(f) === "app")
    for (const rel of rels) {
      const dest = path.join(work, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(o.dir, rel), dest)
    }
    const extra: string[] = []
    for (const [from, names] of Object.entries(r.aliases)) {
      if (!rels.includes(from))
        throw new Error(`The package has no ${from} to copy for an update route.`)
      for (const name of names) {
        if (rels.includes(name)) throw new Error(`The package already has a ${name}.`)
        fs.copyFileSync(path.join(o.dir, from), path.join(work, name))
        extra.push(name)
      }
    }
    fs.writeFileSync(
      path.join(work, MOVE_OVER_FILE),
      JSON.stringify(
        {
          about:
            "This copy arrived by an update route for installs made before a rename. Codehouse moves itself into its own folder with its installer, then this file is gone.",
          version: o.version,
          // The names the install this route serves gives its programs, so Codehouse-Update.exe can start that
          // install again if it ever has to go back to it.
          programs: r.aliases,
        },
        null,
        2,
      ) + "\n",
    )
    const appRels = [...rels, ...extra, MOVE_OVER_FILE].sort()
    const archive = `codeh-${o.version}-route${n}-app.zip`
    const zip = path.join(o.out, archive)
    fs.rmSync(zip, { force: true })
    await writeZip(zip, work, appRels)
    const tree = (await partTrees(work)).app
    return {
      zip,
      part: {
        name: "app",
        ...tree,
        archive,
        size: fs.statSync(zip).size,
        sha256: await hashFile(zip),
      },
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

/** A fresh Ed25519 key pair, PEM, for tests and for setting up a release key. */
export function newReleaseKey(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }
}
