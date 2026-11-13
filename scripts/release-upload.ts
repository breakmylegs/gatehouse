// O28 (13 Nov: "The upload step fails on large files", twice): the release's files go up one at a time, each retried,
// into a draft, and the release is published only once every file on GitHub matches the one here. A failure leaves an
// unpublished draft, never a release with a file missing; running again carries on the same draft.
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export interface Ran {
  status: number | null
  stdout: string
  stderr: string
}
export type Run = (cmd: string, args: string[]) => Ran

export interface PublishOptions {
  run: Run
  repo: string
  tag: string
  title: string
  notesFile: string
  target: string
  files: string[]
  /** Tries for each file, the first included. */
  tries?: number
  /** Waits between tries, in milliseconds (tests pass 0). */
  waitMs?: number
  log?: (line: string) => void
  sleep?: (ms: number) => void
}

interface Asset {
  name: string
  size: number
  digest?: string | null
}

const sleepSync = (ms: number) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")

/** The release's state on GitHub, or undefined when there is none for the tag. */
function view(o: PublishOptions): { isDraft: boolean; assets: Asset[] } | undefined {
  const r = o.run("gh", ["release", "view", o.tag, "--repo", o.repo, "--json", "isDraft,assets"])
  if (r.status !== 0) return undefined
  return JSON.parse(r.stdout) as { isDraft: boolean; assets: Asset[] }
}

/** Which files on GitHub do not match the ones here: missing, another size, or another SHA-256 where GitHub gives one. */
export function mismatched(files: string[], assets: Asset[]): string[] {
  return files
    .filter((f) => {
      const a = assets.find((x) => x.name === path.basename(f))
      if (!a || a.size !== fs.statSync(f).size) return true
      return typeof a.digest === "string" && a.digest.startsWith("sha256:") && a.digest.slice(7) !== sha256(f)
    })
    .map((f) => path.basename(f))
}

export function publishRelease(o: PublishOptions): void {
  const log = o.log ?? ((l: string) => console.log(l))
  const sleep = o.sleep ?? sleepSync
  const tries = o.tries ?? 4
  const wait = o.waitMs ?? 15_000
  let state = view(o)
  if (state && !state.isDraft) throw new Error(`${o.tag} is already published; nothing was changed.`)
  if (!state) {
    const r = o.run("gh", ["release", "create", o.tag, "--repo", o.repo, "--draft", "--title", o.title, "--notes-file", o.notesFile, "--target", o.target])
    if (r.status !== 0) throw new Error(`The draft release could not be made: ${r.stderr.trim()}`)
    state = { isDraft: true, assets: [] }
  } else log(`[release] carrying on the draft of ${o.tag}`)
  for (const f of o.files) {
    if (mismatched([f], state.assets).length === 0) {
      log(`[release] already up: ${path.basename(f)}`)
      continue
    }
    let ok = false
    for (let i = 1; i <= tries && !ok; i++) {
      const r = o.run("gh", ["release", "upload", o.tag, f, "--repo", o.repo, "--clobber"])
      ok = r.status === 0
      if (!ok) {
        log(`[release] upload of ${path.basename(f)} failed (try ${i} of ${tries}): ${r.stderr.trim().split(/\r?\n/).pop() ?? ""}`)
        if (i < tries) sleep(wait * i)
      }
    }
    if (!ok) throw new Error(`${path.basename(f)} could not be uploaded after ${tries} tries. The release is still a draft; run the release again to carry on.`)
    log(`[release] up: ${path.basename(f)}`)
  }
  const after = view(o)
  const bad = after ? mismatched(o.files, after.assets) : o.files.map((f) => path.basename(f))
  if (bad.length) throw new Error(`These files on GitHub do not match the ones here: ${bad.join(", ")}. The release is still a draft.`)
  const r = o.run("gh", ["release", "edit", o.tag, "--repo", o.repo, "--draft=false", "--latest"])
  if (r.status !== 0) throw new Error(`Every file is up and checked, but the release could not be published: ${r.stderr.trim()}`)
}
