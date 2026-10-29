/**
 * Builds the next version beside the current one (JCVC.next next to JCVC), complete and checked, while JCVC keeps
 * running. Parts whose hash is unchanged are copied from the current install; the rest are downloaded, checked
 * against the signed release and unpacked by zip.ts, which checks every name and size before it writes anything.
 * Nothing in the current install is touched. Swapping the folders is JCVC-Update.exe's job, after JCVC has closed.
 */
import fs from "node:fs"
import path from "node:path"
import type { ReleaseManifest, ReleasePart } from "./manifest.js"
import type { UpdateSource } from "./source.js"
import { UpdateError } from "./source.js"
import {
  hashFile,
  listFiles,
  MANIFEST_FILE,
  mapLimit,
  PART_DIRS,
  partTrees,
  REUSABLE,
  SIGNATURE_FILE,
  STAGED_MARKER,
  type PartName,
} from "./tree.js"
import { extractZip } from "./zip.js"

/** What the current install says about itself: its version and part hashes. Absent when run from source. */
export interface InstalledRelease {
  version: string
  parts: Array<{ name: string; tree: string }>
}

export function readInstalled(installDir: string): InstalledRelease | undefined {
  try {
    const v = JSON.parse(
      fs.readFileSync(path.join(installDir, MANIFEST_FILE), "utf8"),
    ) as Partial<InstalledRelease>
    if (typeof v.version !== "string" || !Array.isArray(v.parts)) return undefined
    return {
      version: v.version,
      parts: v.parts.filter((p) => typeof p?.name === "string" && typeof p.tree === "string"),
    }
  } catch {
    return undefined
  }
}

export interface StageProgress {
  step: "download" | "copy" | "unpack" | "check"
  done: number
  total: number
  label: string
}

export interface StageOptions {
  manifest: ReleaseManifest
  /** The exact signed bytes and signature, kept with the new version. */
  manifestBytes: Buffer
  signature: string
  installDir: string
  stagedDir: string
  downloadsDir: string
  installed: InstalledRelease | undefined
  source: UpdateSource
  onProgress?: (p: StageProgress) => void
}

async function copyPart(
  from: string,
  to: string,
  under: string,
  tick: (n: number) => void,
): Promise<void> {
  const rels = await listFiles(from, under)
  const made = new Set<string>()
  await mapLimit(rels, 16, async (rel) => {
    const dest = path.join(to, rel)
    const dir = path.dirname(dest)
    if (!made.has(dir)) {
      await fs.promises.mkdir(dir, { recursive: true })
      made.add(dir)
    }
    await fs.promises.copyFile(path.join(from, rel), dest)
    tick(1)
  })
}

export async function stageRelease(o: StageOptions): Promise<void> {
  const say = o.onProgress ?? (() => undefined)
  const m = o.manifest
  await fs.promises.rm(o.stagedDir, { recursive: true, force: true })
  await fs.promises.mkdir(o.stagedDir, { recursive: true })
  const dlDir = path.join(o.downloadsDir, m.version)
  await fs.promises.mkdir(dlDir, { recursive: true })

  const same = (p: ReleasePart) =>
    REUSABLE.includes(p.name) &&
    o.installed?.parts.some((q) => q.name === p.name && q.tree === p.tree) === true &&
    fs.existsSync(path.join(o.installDir, PART_DIRS[p.name] ?? ""))

  // Room for the new folder and the downloads, with a margin.
  const need = m.parts.reduce((n, p) => n + p.bytes + (same(p) ? 0 : (p.size ?? 0)), 0) * 1.1
  const free = await fs.promises
    .statfs(path.dirname(o.stagedDir))
    .then((s) => s.bavail * s.bsize)
    .catch(() => Infinity)
  if (free < need)
    throw new UpdateError(
      `Not enough free disk space for the update: it needs about ${Math.ceil(need / 1048576)} MB and ${Math.floor(free / 1048576)} MB is free.`,
    )

  const fetchPart = async (p: ReleasePart) => {
    const file = path.join(dlDir, p.archive as string)
    const cached =
      fs.existsSync(file) &&
      fs.statSync(file).size === p.size &&
      (await hashFile(file)) === p.sha256
    if (!cached) {
      let done = 0
      await o.source.download(
        m.version,
        p.archive as string,
        { size: p.size as number, sha256: p.sha256 as string },
        file,
        (n) => {
          done += n
          say({ step: "download", done, total: p.size as number, label: `Downloading ${p.name}` })
        },
      )
    }
    say({ step: "unpack", done: 0, total: p.files, label: `Unpacking ${p.name}` })
    await extractZip(file, o.stagedDir, p.name, { files: p.files, bytes: p.bytes })
  }

  const reused = new Set<PartName>()
  for (const p of m.parts) {
    if (same(p)) {
      let done = 0
      await copyPart(o.installDir, o.stagedDir, PART_DIRS[p.name] as string, (n) => {
        done += n
        if (done % 250 === 0 || done === p.files)
          say({ step: "copy", done, total: p.files, label: `Copying ${p.name} from this version` })
      })
      reused.add(p.name)
    } else await fetchPart(p)
  }

  // The new folder must be exactly the release. A copied part that does not match (changed on disk) is downloaded.
  say({ step: "check", done: 0, total: m.parts.length, label: "Checking the new version" })
  let trees = await partTrees(o.stagedDir)
  for (const p of m.parts) {
    if (trees[p.name].tree === p.tree) continue
    if (!reused.has(p.name))
      throw new UpdateError(`The ${p.name} part does not match the signed release.`)
    await fs.promises.rm(path.join(o.stagedDir, PART_DIRS[p.name] as string), {
      recursive: true,
      force: true,
    })
    await fetchPart(p)
    trees = await partTrees(o.stagedDir)
    if (trees[p.name].tree !== p.tree)
      throw new UpdateError(`The ${p.name} part does not match the signed release.`)
  }
  await fs.promises.writeFile(path.join(o.stagedDir, MANIFEST_FILE), o.manifestBytes)
  await fs.promises.writeFile(path.join(o.stagedDir, SIGNATURE_FILE), o.signature)
  await fs.promises.writeFile(path.join(o.stagedDir, STAGED_MARKER), m.version)
  say({ step: "check", done: m.parts.length, total: m.parts.length, label: "Ready" })
}
