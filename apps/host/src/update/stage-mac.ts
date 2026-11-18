/**
 * Mac fork (18 Nov): builds the next Codehouse.app in Codehouse's own updates folder, never inside Applications, complete
 * and checked, while Codehouse keeps running. Parts whose hash is unchanged (its packages and Node, usually) are cloned
 * from the installed app and hashed again; the rest are downloaded, checked against the signed release and unpacked by
 * zip.ts with their modes and links. The whole app must then pass macOS's own seal check (codesign --verify --strict).
 * Nothing in the installed app is touched: swapping them is packaging/mac/codehouse-update.sh's job, once Codehouse quits.
 *
 *   <updates>/mac-next/Codehouse.app      the new app
 *   <updates>/mac-next/release.json, .sig the signed description it was built from
 *   <updates>/mac-next/.codehouse-staged  its version, written last, so a restart knows it is ready
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { MAC_PART_DIRS, MAC_REUSABLE, listMacFiles, macPartOf, macTreeHash, type MacManifest, type MacPart } from "./release-mac.js"
import { UpdateError, type UpdateSource } from "./source.js"
import type { StageProgress } from "./stage.js"
import { hashFile, MANIFEST_FILE, SIGNATURE_FILE, STAGED_MARKER } from "./tree.js"
import { extractZip } from "./zip.js"

const run = promisify(execFile)

export const MAC_APP = "Codehouse.app"

export interface MacStageOptions {
  manifest: MacManifest
  manifestBytes: Buffer
  signature: string
  /** The installed Codehouse.app. */
  app: string
  /** <updates>/mac-next */
  nextDir: string
  downloadsDir: string
  source: UpdateSource
  onProgress?: (p: StageProgress) => void
  /** Tests: the seal check (codesign --verify --strict), which a test app has no seal for. */
  verifySeal?: (app: string) => Promise<void>
}

/** macOS's own check that the app is whole and sealed as it was signed. */
export async function codesignVerify(app: string): Promise<void> {
  try {
    await run("/usr/bin/codesign", ["--verify", "--strict", app], { timeout: 120_000 })
  } catch (e) {
    const why = String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().split("\n").pop()
    throw new UpdateError(`The new Codehouse.app did not pass macOS's seal check (${why}). It was refused.`)
  }
}

const partRels = async (app: string, name: string) => (await listMacFiles(app)).filter((r) => macPartOf(r) === name)

/** Builds and checks the new app. Throws UpdateError, leaving nextDir for the caller to remove. */
export async function stageMacRelease(o: MacStageOptions): Promise<void> {
  const target = path.join(o.nextDir, MAC_APP)
  await fs.promises.rm(o.nextDir, { recursive: true, force: true })
  await fs.promises.mkdir(target, { recursive: true })
  const say = (p: StageProgress) => o.onProgress?.(p)
  const installed = fs.existsSync(o.app) ? await listMacFiles(o.app) : []
  const reuse: MacPart[] = []
  for (const p of o.manifest.parts) {
    if (!(MAC_REUSABLE as readonly string[]).includes(p.name)) continue
    const rels = installed.filter((r) => macPartOf(r) === p.name)
    if (rels.length === p.files && (await macTreeHash(o.app, rels)) === p.tree) reuse.push(p)
  }
  const fetch = o.manifest.parts.filter((p) => !reuse.includes(p))
  const total = fetch.reduce((n, p) => n + p.size, 0)
  let done = 0
  const dl = path.join(o.downloadsDir, o.manifest.version)
  await fs.promises.mkdir(dl, { recursive: true })
  for (const p of fetch) {
    const file = path.join(dl, p.archive)
    const have = fs.existsSync(file) && fs.statSync(file).size === p.size && (await hashFile(file)) === p.sha256
    if (!have)
      await o.source.download(o.manifest.version, p.archive, { size: p.size, sha256: p.sha256 }, file, (n) => {
        done += n
        say({ step: "download", done, total, label: p.archive })
      })
    else done += p.size
    say({ step: "unpack", done: 0, total: p.files, label: p.name })
    await extractZip(file, target, p.name, { files: p.files, bytes: p.bytes }, { unix: true, of: macPartOf })
  }
  for (const p of reuse) {
    say({ step: "copy", done: 0, total: p.files, label: p.name })
    const dir = MAC_PART_DIRS[p.name as keyof typeof MAC_PART_DIRS]
    await fs.promises.mkdir(path.dirname(path.join(target, dir)), { recursive: true })
    // A clone where the disk can (APFS): no new space taken, and links copied as links.
    await fs.promises.cp(path.join(o.app, dir), path.join(target, dir), {
      recursive: true,
      verbatimSymlinks: true,
      mode: fs.constants.COPYFILE_FICLONE,
    })
  }
  say({ step: "check", done: 0, total: o.manifest.parts.length, label: "the new Codehouse.app" })
  const all = await listMacFiles(target)
  const stray = all.find((r) => !macPartOf(r))
  if (stray) throw new UpdateError(`The new Codehouse.app holds ${stray}, which no part of the release has. It was refused.`)
  for (const p of o.manifest.parts) {
    const rels = await partRels(target, p.name)
    if (rels.length !== p.files || (await macTreeHash(target, rels)) !== p.tree)
      throw new UpdateError(`The new Codehouse.app's ${p.name} does not match the signed release. It was refused.`)
  }
  await (o.verifySeal ?? codesignVerify)(target)
  await fs.promises.writeFile(path.join(o.nextDir, MANIFEST_FILE), o.manifestBytes)
  await fs.promises.writeFile(path.join(o.nextDir, SIGNATURE_FILE), o.signature)
  await fs.promises.writeFile(path.join(o.nextDir, STAGED_MARKER), o.manifest.version)
}
