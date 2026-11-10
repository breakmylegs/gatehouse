/**
 * Search and replace across a session's files (backlog G35). Searching runs git grep in its own process, with a time
 * limit, so a slow pattern can never stall the Host; outside a repository it uses git grep --no-index, and either way
 * it skips what git ignores. Replacing shows each changed line first, then writes only the files still as they were
 * shown, after a checkpoint, so Undo in Changes puts them back; a file the policy floor blocks is never touched.
 */
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export class SearchError extends Error {}

export interface SearchOptions {
  pattern: string
  regex?: boolean
  caseSensitive?: boolean
}

export interface Match {
  path: string
  line: number
  text: string
}

/** The most matches returned, the longest line shown, and the largest file a replace reads. */
const MAX_MATCHES = 2000
const MAX_LINE = 400
const MAX_FILE = 1024 * 1024
const MAX_REPLACE_FILES = 500

function git(cwd: string, args: string[]): Promise<{ out: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: 15_000, maxBuffer: 32 * 1024 * 1024 },
      (e, stdout, stderr) => {
        const code =
          e && typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : 0
        // git grep answers 1 when nothing matched.
        if (e && code !== 1)
          reject(
            new SearchError(
              String(stderr || e.message)
                .trim()
                .slice(0, 300),
            ),
          )
        else resolve({ out: String(stdout), code })
      },
    )
  })
}

function check(o: SearchOptions): void {
  if (!o.pattern || o.pattern.length > 500) throw new SearchError("Search for 1 to 500 characters.")
  if (o.regex)
    try {
      new RegExp(o.pattern)
    } catch {
      throw new SearchError("That is not a regular expression that can be read.")
    }
}

/** Every line under `root` that matches, up to MAX_MATCHES, files in name order. */
export async function searchFiles(
  root: string,
  o: SearchOptions,
): Promise<{ matches: Match[]; truncated: boolean }> {
  check(o)
  const inRepo = await git(root, ["rev-parse", "--is-inside-work-tree"]).then(
    (r) => r.out.trim() === "true",
    () => false,
  )
  const args = [
    "-c",
    "core.quotepath=off",
    "grep",
    ...(inRepo ? ["--untracked"] : ["--no-index", "--exclude-standard"]),
    "-n",
    "-I",
    "--no-color",
    "--full-name",
    ...(o.caseSensitive ? [] : ["-i"]),
    o.regex ? "-P" : "-F",
    "-e",
    o.pattern,
    "--",
    ".",
  ]
  let r: { out: string; code: number }
  try {
    r = await git(root, args)
  } catch (e) {
    // A git without PCRE: the extended syntax covers most patterns people type.
    if (!o.regex) throw e
    r = await git(
      root,
      args.map((a) => (a === "-P" ? "-E" : a)),
    )
  }
  const matches: Match[] = []
  let truncated = false
  for (const l of r.out.split(/\r?\n/)) {
    if (!l) continue
    const m = /^(.*?):(\d+):(.*)$/.exec(l)
    if (!m) continue
    if (matches.length >= MAX_MATCHES) {
      truncated = true
      break
    }
    const text = m[3]!
    matches.push({
      path: m[1]!.replace(/\\/g, "/"),
      line: Number(m[2]),
      text: text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text,
    })
  }
  return { matches, truncated }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function matcher(o: SearchOptions): RegExp {
  check(o)
  return new RegExp(o.regex ? o.pattern : escape(o.pattern), `g${o.caseSensitive ? "" : "i"}`)
}

export interface FilePreview {
  path: string
  /** A hash of the file as shown, so the replace writes only what you saw. */
  hash: string
  lines: Array<{ line: number; before: string; after: string }>
  count: number
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex")

/** Reads a file to change, or says why it is left alone. */
type Read = (rel: string) => Promise<{ abs: string; text: string } | { skip: string }>

/** The changes a replace would make, line by line, per file. Files it cannot or may not change are listed apart. */
export async function previewReplace(
  paths: readonly string[],
  o: SearchOptions,
  replacement: string,
  read: Read,
): Promise<{ files: FilePreview[]; skipped: Array<{ path: string; why: string }> }> {
  if (paths.length > MAX_REPLACE_FILES)
    throw new SearchError(`Replace in up to ${MAX_REPLACE_FILES} files at a time.`)
  const re = matcher(o)
  const files: FilePreview[] = []
  const skipped: Array<{ path: string; why: string }> = []
  for (const rel of [...new Set(paths)]) {
    const got = await read(rel)
    if ("skip" in got) {
      skipped.push({ path: rel, why: got.skip })
      continue
    }
    const lines: FilePreview["lines"] = []
    let count = 0
    got.text.split("\n").forEach((before, i) => {
      re.lastIndex = 0
      const n = before.match(re)?.length ?? 0
      if (!n) return
      count += n
      lines.push({ line: i + 1, before, after: before.replace(re, replacement) })
    })
    if (count) files.push({ path: rel, hash: hash(got.text), lines, count })
  }
  return { files, skipped }
}

/** Writes the replace into each file still as it was shown, and says which were changed and which were not. */
export async function applyReplace(
  shown: ReadonlyArray<{ path: string; hash: string }>,
  o: SearchOptions,
  replacement: string,
  read: Read,
  write: (abs: string, text: string) => Promise<void>,
): Promise<{ changed: string[]; skipped: Array<{ path: string; why: string }>; count: number }> {
  const re = matcher(o)
  const changed: string[] = []
  const skipped: Array<{ path: string; why: string }> = []
  let count = 0
  for (const f of shown) {
    const got = await read(f.path)
    if ("skip" in got) {
      skipped.push({ path: f.path, why: got.skip })
      continue
    }
    if (hash(got.text) !== f.hash) {
      skipped.push({ path: f.path, why: "It changed since you looked, so it was left as it is." })
      continue
    }
    const n = got.text.split("\n").reduce((a, l) => {
      re.lastIndex = 0
      return a + (l.match(re)?.length ?? 0)
    }, 0)
    const next = got.text
      .split("\n")
      .map((l) => l.replace(re, replacement))
      .join("\n")
    await write(got.abs, next)
    changed.push(f.path)
    count += n
  }
  return { changed, skipped, count }
}

/** A reader for files inside `root`: real paths only, no links out, text only, not too large, not blocked. */
export function readerFor(
  root: string,
  inside: (root: string, rel: string) => { abs?: string; error?: string },
  blocked: (abs: string) => Promise<string | undefined>,
): Read {
  return async (rel) => {
    const where = inside(root, rel)
    if (!where.abs) return { skip: where.error ?? "Not allowed." }
    const why = await blocked(where.abs)
    if (why) return { skip: `Blocked by the policy: ${why}` }
    let st: fs.Stats
    try {
      st = fs.statSync(where.abs)
    } catch {
      return { skip: "It is not there." }
    }
    if (!st.isFile()) return { skip: "It is not a file." }
    if (st.size > MAX_FILE) return { skip: "It is over 1 MB, so it is left alone." }
    const buf = fs.readFileSync(where.abs)
    if (buf.includes(0)) return { skip: "It is not text." }
    return { abs: where.abs, text: buf.toString("utf8") }
  }
}

export const relTo = (root: string, abs: string) =>
  path.relative(root, abs).split(path.sep).join("/")
