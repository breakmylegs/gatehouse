/**
 * E-071, the teach-back check (Expansion E6). You explain a large change in a few lines; Codehouse compares the
 * explanation with the change and lists what it leaves out: each changed module (a folder, as a reader would name it)
 * the explanation does not mention by its folder or one of its files' names, with the files and lines changed there.
 * It reads the change from git (since where the work left its default branch, with what is not committed yet) and the
 * words you typed; nothing is sent anywhere. Comparing the meaning as well, with a model on this computer, is not built:
 * sending a diff to a model is for the data boundary rules (C-016, D-085) to allow, and is listed for later.
 */
import { execFile } from "node:child_process"
import path from "node:path"

export interface ChangedFile {
  file: string
  added: number
  removed: number
}

export interface ModuleGap {
  module: string
  files: string[]
  lines: number
}

export interface TeachBack {
  modules: number
  covered: string[]
  gaps: ModuleGap[]
  /** Fewer than this many changed lines is not a large change, and the check says so. */
  lines: number
}

/** Lower case, without separators, and singular (migrations and migration name the same module). */
const norm = (s: string) => s.toLowerCase().replace(/[-_.\s]+/g, "").replace(/(?<=\w{3})s$/, "")
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9_-]+/).flatMap((w) => [norm(w), ...w.split(/[-_]/).map(norm)]).filter((w) => w.length >= 3))

/** The module of a file: its first two folders, or its own name at the top. */
export function moduleOf(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/")
  const dirs = parts.slice(0, -1)
  return dirs.length ? dirs.slice(0, 2).join("/") : parts[0]!
}

/** The modules a change touches that the explanation does not name. */
export function teachBack(explanation: string, changed: ChangedFile[]): TeachBack {
  const said = words(explanation)
  const joined = norm(explanation)
  const byModule = new Map<string, ChangedFile[]>()
  for (const f of changed) byModule.set(moduleOf(f.file), [...(byModule.get(moduleOf(f.file)) ?? []), f])
  const covered: string[] = []
  const gaps: ModuleGap[] = []
  for (const [module, files] of byModule) {
    // Named if any folder of the module, or any of its files' names, is in what you wrote.
    const names = [...module.split("/"), ...files.map((f) => path.posix.basename(f.file.replace(/\\/g, "/")).replace(/\.[^.]+$/, ""))].map(norm).filter((n) => !["src", "lib", "app", "apps", "test", "tests", "packages", "index", "main"].includes(n))
    const named = names.some((n) => said.has(n) || (n.length >= 5 && joined.includes(n)))
    if (named) covered.push(module)
    else gaps.push({ module, files: files.map((f) => f.file), lines: files.reduce((a, f) => a + f.added + f.removed, 0) })
  }
  gaps.sort((a, b) => b.lines - a.lines)
  return { modules: byModule.size, covered, gaps, lines: changed.reduce((a, f) => a + f.added + f.removed, 0) }
}

const git = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => execFile("git", args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => resolve(e ? undefined : String(out))))

/** The files the change touches, with lines added and removed: since the default branch, and not yet committed. */
export async function changedSince(root: string): Promise<ChangedFile[]> {
  const base = ((await git(root, ["merge-base", "HEAD", "origin/HEAD"])) ?? (await git(root, ["merge-base", "HEAD", "main"])) ?? "").trim()
  const out = (await git(root, ["diff", "--numstat", base || "HEAD"])) ?? ""
  const files = out
    .split("\n")
    .map((l) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ file: m[3]!.replace(/^.*\{(.*) => (.*)\}.*$/, (_s, _a, b: string) => b), added: m[1] === "-" ? 0 : Number(m[1]), removed: m[2] === "-" ? 0 : Number(m[2]) }))
  const untracked = ((await git(root, ["ls-files", "--others", "--exclude-standard"])) ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
  for (const u of untracked) if (!files.some((f) => f.file === u)) files.push({ file: u, added: 1, removed: 0 })
  return files
}
