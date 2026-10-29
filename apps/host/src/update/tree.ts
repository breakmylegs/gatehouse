/**
 * An installed JCVC folder is three parts: the application (small, changes every release), its node_modules (large,
 * changes when a dependency does) and the Node runtime (large, changes rarely). Each part has a tree hash over its
 * file names and contents, so an update can tell which parts it really needs to download. The release script and
 * the updater both use this file, so the two can never disagree about what a hash means.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const PART_NAMES = ["app", "modules", "runtime"] as const
export type PartName = (typeof PART_NAMES)[number]
/** Large parts that an update copies from the current install when their hash is unchanged. */
export const REUSABLE: readonly PartName[] = ["modules", "runtime"]
/** The signed description of a release, kept next to JCVC.exe. Not part of any tree. */
export const MANIFEST_FILE = "release.json"
export const SIGNATURE_FILE = "release.sig"
/** Written last into a finished staging folder, holding the version, so a restart knows it is ready. */
export const STAGED_MARKER = ".jcvc-staged"

/** Where a part lives inside the install folder. The app part is everything else. */
export const PART_DIRS: Partial<Record<PartName, string>> = {
  modules: "app/node_modules",
  runtime: "runtime",
}

export function partOf(rel: string): PartName | undefined {
  if (rel === MANIFEST_FILE || rel === SIGNATURE_FILE || rel === STAGED_MARKER) return undefined
  if (rel.startsWith("runtime/")) return "runtime"
  if (rel.startsWith("app/node_modules/")) return "modules"
  return "app"
}

/**
 * Every file under root (or under one folder of it), as forward-slash paths relative to root, sorted. Links are left
 * out: the only ones in JCVC are npm's workspace junctions, which scripts/links.mjs makes on every start.
 */
export async function listFiles(root: string, under = ""): Promise<string[]> {
  const start = under ? path.join(root, under) : root
  if (!fs.existsSync(start)) return []
  const out: string[] = []
  // A walk of its own: Node's recursive listing can descend into a junction, and these must never be followed.
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join("/"))
    }
  }
  await walk(start)
  return out.sort()
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256")
    fs.createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")))
  })
}

/** Runs fn over items, at most `limit` at a time, keeping the order of the results. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** sha256 over "path NUL sha256(content) LF" for each file, in sorted order. Names and contents, nothing else. */
export async function treeHash(root: string, rels: string[], tick?: () => void): Promise<string> {
  const sorted = [...rels].sort()
  const hashes = await mapLimit(sorted, 16, async (rel) => {
    const h = await hashFile(path.join(root, rel))
    tick?.()
    return h
  })
  const h = crypto.createHash("sha256")
  sorted.forEach((rel, i) => h.update(`${rel}\0${hashes[i]}\n`))
  return h.digest("hex")
}

export interface PartTree {
  tree: string
  files: number
  bytes: number
}

/** The tree hash, file count and size of each part of an install folder. */
export async function partTrees(root: string): Promise<Record<PartName, PartTree>> {
  const all = await listFiles(root)
  const out = {} as Record<PartName, PartTree>
  for (const name of PART_NAMES) {
    const rels = all.filter((r) => partOf(r) === name)
    let bytes = 0
    for (const r of rels) bytes += fs.statSync(path.join(root, r)).size
    out[name] = { tree: await treeHash(root, rels), files: rels.length, bytes }
  }
  return out
}
