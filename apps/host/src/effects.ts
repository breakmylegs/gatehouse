/**
 * What a call would do that cannot be taken back, worked out before you decide (backlog G20): the files a delete would
 * remove, or the uncommitted work a git command would throw away, counted, the first few named, and whether git can
 * bring them back. Shown on the approval card and the phone, and Extreme approval and the judge never approve a call
 * that cannot be undone by themselves.
 *
 * It errs one way only: when it cannot tell (a variable in a path, a pattern it does not expand, git not answering),
 * the call is taken as one that cannot be undone. Git runs without a shell, read-only (status, ls-files, a dry-run
 * clean), with a short time limit.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Effects, Touch } from "@gatehouse/shared"

export type { Effects, Touch }

/** Said when working out the effects failed outright: taken as a call that cannot be undone. */
export const UNKNOWN_EFFECTS: Effects = {
  kind: "delete",
  count: 0,
  paths: [],
  more: true,
  reversible: false,
  undo: "Codehouse could not work out what this would delete, so take it that it cannot be undone.",
}

type Git = (cwd: string, args: string[]) => Promise<string>

const git: Git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
      (e, stdout) => (e ? reject(e) : resolve(String(stdout))),
    )
  })

const MAX_PATHS = 20
/** The most files counted under the targets; past it the count says "more". */
const MAX_WALK = 5000

/** Words of a command, with quotes taken off; split into the commands it chains. */
export function commandsOf(line: string): string[][] {
  const out: string[][] = []
  let words: string[] = []
  let word = ""
  let quote: string | undefined
  let started = false
  const end = () => {
    if (started) words.push(word)
    word = ""
    started = false
  }
  const next = () => {
    end()
    if (words.length) out.push(words)
    words = []
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote) {
      if (c === quote) quote = undefined
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (c === ";" || c === "|" || c === "&" || c === "\n" || c === "\r") next()
    else if (c === " " || c === "\t") end()
    else {
      word += c
      started = true
    }
  }
  next()
  return out
}

/** A path it cannot read as a plain path: a variable, a home folder, a command inside it, or a deep pattern. */
const UNREADABLE = /[$%`~]|\*\*|[{}[\]]/

const DELETERS = new Set(["rm", "rmdir", "unlink", "del", "erase", "rd", "remove-item", "ri"])

/**
 * Options of the shell's own rmdir that keep it to empty folders (owner, 9 Nov: Extreme approval asked about
 * `rmdir "$TEMP/ae"`, taking it for a delete it could not undo). Any other option, or rmdir in PowerShell (an alias of
 * Remove-Item, which removes whole folders), is a delete like any other.
 */
const EMPTY_ONLY_RMDIR = /^(-p|-v|-pv|-vp|--parents|--verbose|--ignore-fail-on-non-empty)$/

/** The paths a delete command names (options left out), or undefined when it is not a delete. */
function deleteTargets(words: string[], toolName: string): string[] | undefined {
  const name = (words[0] ?? "").toLowerCase().replace(/\.exe$/, "")
  if (!DELETERS.has(name)) return undefined
  // The shell's rmdir removes only empty folders: it can lose no file, so there is nothing to undo.
  if (
    toolName === "Bash" &&
    name === "rmdir" &&
    words.slice(1).every((w) => !w.startsWith("-") || EMPTY_ONLY_RMDIR.test(w))
  )
    return []
  const out: string[] = []
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!
    if (/^-(path|literalpath)$/i.test(w)) {
      if (words[i + 1] !== undefined) out.push(...words[++i]!.split(","))
      continue
    }
    if (/^-(include|exclude|filter)$/i.test(w)) {
      // A filter makes the set of files unknowable here.
      out.push("**")
      i++
      continue
    }
    // Options: -rf, --force, /s /q (cmd), -Recurse -Force (PowerShell).
    if (/^--?[A-Za-z]/.test(w) || /^\/[A-Za-z]$/.test(w)) continue
    if (w === "--") continue
    out.push(w)
  }
  return out
}

/** git reset --hard, git checkout -- <paths> or ., git restore <paths> (not --staged), git clean. */
function gitDiscard(
  words: string[],
): { kind: "reset" | "restore" | "clean"; args: string[] } | undefined {
  if ((words[0] ?? "").toLowerCase().replace(/\.exe$/, "") !== "git") return undefined
  const rest = words.slice(1).filter((w) => !/^-C$/.test(w))
  const sub = rest[0]
  const args = rest.slice(1)
  if (sub === "reset" && args.includes("--hard")) return { kind: "reset", args: [] }
  if (sub === "clean" && args.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--force"))
    return { kind: "clean", args }
  if (sub === "restore" && !args.includes("--staged") && !args.includes("-S"))
    return { kind: "restore", args: args.filter((a) => !a.startsWith("-")) }
  if (sub === "checkout" && args.includes("--"))
    return { kind: "restore", args: args.slice(args.indexOf("--") + 1) }
  if (sub === "checkout" && args.length === 1 && args[0] === ".")
    return { kind: "restore", args: ["."] }
  return undefined
}

const shown = (cwd: string, p: string) => {
  const rel = path.relative(cwd, p)
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.replace(/\\/g, "/") : p
}

/** The files under the targets, walked without following links. */
function filesUnder(
  cwd: string,
  targets: string[],
): { files: string[]; more: boolean; unknown: boolean } {
  const files: string[] = []
  let more = false
  let unknown = false
  const walk = (p: string) => {
    if (files.length >= MAX_WALK) {
      more = true
      return
    }
    let st: fs.Stats
    try {
      st = fs.lstatSync(p)
    } catch {
      return // not there: nothing to delete
    }
    if (st.isDirectory()) {
      let names: string[]
      try {
        names = fs.readdirSync(p)
      } catch {
        unknown = true
        return
      }
      for (const n of names) walk(path.join(p, n))
    } else files.push(p)
  }
  for (const t of targets) {
    if (UNREADABLE.test(t)) {
      unknown = true
      continue
    }
    const abs = path.resolve(cwd, t)
    const base = path.basename(abs)
    if (/[*?]/.test(path.dirname(abs))) {
      unknown = true
      continue
    }
    if (/[*?]/.test(base)) {
      const re = new RegExp(
        `^${base
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`,
        "i",
      )
      let names: string[] = []
      try {
        names = fs.readdirSync(path.dirname(abs))
      } catch {
        // no such folder: nothing matches
      }
      for (const n of names) if (re.test(n)) walk(path.join(path.dirname(abs), n))
    } else walk(abs)
  }
  return { files, more, unknown }
}

/** Of these files, how many git could not bring back: not in a repository, not committed, changed since, or ignored. */
async function notRestorable(cwd: string, files: string[], run: Git): Promise<number> {
  if (!files.length) return 0
  let top: string
  try {
    top = path.resolve((await run(cwd, ["rev-parse", "--show-toplevel"])).trim())
  } catch {
    return files.length
  }
  const inside = files.filter((f) => !path.relative(top, f).startsWith(".."))
  let lost = files.length - inside.length
  // Tracked files, as git knows them; those also listed by status as changed are not as committed.
  const rel = inside.map((f) => path.relative(top, f).replace(/\\/g, "/"))
  try {
    const tracked = new Set(
      (await run(top, ["ls-files", "-z", "--", ...rel.slice(0, 500)])).split("\0").filter(Boolean),
    )
    const changed = new Set(
      (
        await run(top, [
          "status",
          "--porcelain",
          "-z",
          "--untracked-files=no",
          "--",
          ...rel.slice(0, 500),
        ])
      )
        .split("\0")
        .filter(Boolean)
        .map((l) => l.slice(3)),
    )
    for (const r of rel.slice(0, 500)) if (!tracked.has(r) || changed.has(r)) lost++
    lost += Math.max(0, rel.length - 500)
  } catch {
    return files.length
  }
  return lost
}

/** D-014: commands that move their sources, and those that copy onto their destination. */
const MOVERS = new Set(["mv", "move", "mi", "move-item", "ren", "rename", "rename-item", "rni"])
const RENAMERS = new Set(["ren", "rename", "rename-item", "rni"])
const COPIERS = new Set(["cp", "copy", "cpi", "copy-item", "xcopy", "robocopy"])
const WRITERS = new Set(["set-content", "sc", "out-file", "tee", "tee-object"])
const NULL_DEVICE = /^(\/dev\/null|nul:?|\$null)$/i

/** What is at a path now, looked at only (links not followed): for the card's "Would touch" list. */
function whatIsAt(cwd: string, p: string): string {
  if (UNREADABLE.test(p) || /[*?]/.test(p)) return "pattern"
  try {
    return fs.lstatSync(path.resolve(cwd, p)).isDirectory() ? "folder" : "file"
  } catch {
    return "not there"
  }
}

/** The operands of a move or copy: [sources, destination], PowerShell's -Path and -Destination picked out. */
function moveOperands(words: string[]): [string[], string | undefined] {
  const plain: string[] = []
  let dest: string | undefined
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!
    if (/^-(path|literalpath)$/i.test(w)) {
      if (words[i + 1] !== undefined) plain.push(...words[++i]!.split(","))
    } else if (/^-(destination|newname)$/i.test(w)) dest = words[++i]
    else if (/^-(include|exclude|filter|value|encoding|inputobject|width)$/i.test(w)) i++
    else if (/^--?[A-Za-z]/.test(w) || /^\/[A-Za-z]+(:.*)?$/.test(w) || w === "--") continue
    else plain.push(w)
  }
  if (dest === undefined && plain.length > 1) dest = plain.pop()
  return [plain, dest]
}

/**
 * D-014, consequence preview (the safe variant): the paths a shell call would move or overwrite, read from its words,
 * so the card can show them beside what G20 says it deletes. Nothing is run, not even git: each path is only looked
 * at. Output redirects (>, not >>), Set-Content and Out-File overwrite; mv and Move-Item move their sources onto a
 * destination; cp, Copy-Item, xcopy and robocopy overwrite theirs. At most 20.
 */
export function touchesOf(toolName: string, input: Record<string, unknown>, cwd: string): Touch[] {
  if (toolName !== "Bash" && toolName !== "PowerShell") return []
  const command = typeof input.command === "string" ? input.command : ""
  const out: Touch[] = []
  const seen = new Set<string>()
  const add = (effect: Touch["effect"], p: string | undefined) => {
    if (!p || NULL_DEVICE.test(p) || out.length >= MAX_PATHS) return
    const key = `${effect}:${p}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ effect, path: UNREADABLE.test(p) ? p : shown(cwd, path.resolve(cwd, p)), what: whatIsAt(cwd, p) })
  }
  for (const raw of commandsOf(command)) {
    // A redirect overwrites its file whatever the command: "> f", ">f" or "2> f"; ">>" appends and "2>&1" names no file.
    const words: string[] = []
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i]!
      const append = /^\d?>>(.*)$/.exec(w)
      const over = /^\d?>(.*)$/.exec(w)
      if (append) {
        if (!append[1]) i++
      } else if (over) {
        const target = over[1] || raw[++i]
        if (!target?.startsWith("&")) add("overwrite", target)
      } else words.push(w)
    }
    const name = (words[0] ?? "").toLowerCase().replace(/\.exe$/, "")
    const appends = words.some((w) => /^(-a|--append|-append)$/i.test(w))
    if (MOVERS.has(name)) {
      const [sources, dest] = moveOperands(words)
      for (const s of sources) add("move", s)
      if (!RENAMERS.has(name)) add("overwrite", dest)
    } else if (COPIERS.has(name)) add("overwrite", moveOperands(words)[1])
    else if (WRITERS.has(name) && !appends) {
      const [first, last] = moveOperands(words)
      add("overwrite", first[0] ?? last)
    }
  }
  return out
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/** The effects of a shell command, or undefined when it deletes and discards nothing. */
export async function effectsOf(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  run: Git = git,
): Promise<Effects | undefined> {
  if (toolName !== "Bash" && toolName !== "PowerShell") return undefined
  const command = typeof input.command === "string" ? input.command : ""
  if (!command) return undefined
  const targets: string[] = []
  const discards: Array<NonNullable<ReturnType<typeof gitDiscard>>> = []
  for (const words of commandsOf(command)) {
    const t = deleteTargets(words, toolName)
    if (t) targets.push(...t)
    const d = gitDiscard(words)
    if (d) discards.push(d)
  }
  if (!targets.length && !discards.length) return undefined

  if (discards.length) {
    // Changes not committed that the command would throw away (and, for clean, untracked files it would delete).
    const lost: string[] = []
    let unknown = false
    for (const d of discards) {
      try {
        if (d.kind === "clean") {
          const flags = d.args.filter((a) => /^-[dxX]+$/.test(a))
          const paths = d.args.filter((a) => !a.startsWith("-"))
          if (paths.some((p) => UNREADABLE.test(p))) unknown = true
          const out = await run(cwd, ["clean", "-n", ...flags, "--", ...paths])
          lost.push(
            ...out
              .split(/\r?\n/)
              .filter(Boolean)
              .map((l) => l.replace(/^Would remove /, "")),
          )
        } else {
          if (d.args.some((p) => UNREADABLE.test(p))) unknown = true
          const out = await run(cwd, [
            "status",
            "--porcelain",
            "--untracked-files=no",
            "--",
            ...(d.kind === "reset" ? [] : d.args.filter((p) => !UNREADABLE.test(p))),
          ])
          lost.push(
            ...out
              .split(/\r?\n/)
              .filter(Boolean)
              .map((l) => l.slice(3)),
          )
        }
      } catch {
        unknown = true
      }
    }
    const files = [...new Set(lost)]
    if (!files.length && !unknown && !targets.length) return undefined
    if (!targets.length)
      return {
        kind: "discard",
        count: files.length,
        paths: files.slice(0, MAX_PATHS),
        more: unknown || files.length > MAX_PATHS,
        reversible: false,
        undo: unknown
          ? "Codehouse could not tell what it would throw away, so take it that it cannot be undone."
          : `Cannot be undone: ${plural(files.length, "file's", "files'")} work not committed would be lost. Commit or stash first if you want to keep it.`,
      }
  }

  const { files, more, unknown } = filesUnder(cwd, targets)
  const lost = unknown ? files.length + 1 : await notRestorable(cwd, files, run)
  const reversible = !unknown && !discards.length && lost === 0
  return {
    kind: "delete",
    count: files.length,
    paths: files.slice(0, MAX_PATHS).map((f) => shown(cwd, f)),
    more: more || unknown || files.length > MAX_PATHS,
    reversible,
    undo: unknown
      ? "Codehouse could not tell every file it would delete, so take it that it cannot be undone."
      : files.length === 0
        ? "None of the files it names is there now."
        : reversible
          ? "Every one is committed in git as it is: git restore (or git checkout HEAD --) brings them back."
          : `Cannot be undone: ${plural(lost, "file is", "files are")} not committed in git as they are, so git cannot bring ${lost === 1 ? "it" : "them"} back.`,
  }
}
