import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { hasRealCard } from "@gatehouse/policy"

/**
 * Secrets in a commit (backlog G22; "a plain in-repo scanner, never gitleaks", the owner's rule). Before a session's
 * `git commit` runs, the floor reads the lines the commit would add and refuses it when one holds a key or a private
 * key. Only patterns that are almost never anything else are used, so ordinary code is not stopped; the refusal names
 * the kind and the file, never the value. When it cannot check, the call goes to a person instead (fail closed).
 * Commits you make yourself, in your own terminal, are yours and are not scanned.
 *
 * D-058 (Frontier build, Wave 1): a push is read the same way, from the commits it would send, so a secret committed
 * earlier (by you, or before Codehouse) is not sent on by a session. Each finding names the file and the line, never
 * the value, and for a push the commit too.
 *
 * Fixed 24 Nov (a push from C:\dev\peter refused every time): a push was judged on every commit on every local branch
 * no remote had, so an unpushed commit on another branch (one that added a placeholder at its own line 496) refused
 * every push from main; and "push" anywhere in a commit message made a commit read that too. Now a push is judged only
 * on the lines added by the commits it sends (`<remote>/<branch>..<local>`), a push is a git push only when push is the
 * subcommand, and a placeholder in a web address (<PASSWORD>, $VAR, ${VAR}, ***, REPLACE_WITH_..., changeme) is not a
 * password. Removed lines were never read, and nothing is cached: each check reads git again.
 *
 * O59 (owner, 27 Nov): each branch a push sends is judged from what the remote has now (its branch read freshly with
 * git ls-remote), so a stale remote-tracking ref counts nothing the remote already has; a remote that cannot be asked
 * means more is read, never less; and a finding names the branch that sends it. A finding the owner allowed once in
 * Settings, Safety, Held for secrets (secret-holds.ts) is let through by the floor once.
 */
export const SECRET_IN_COMMIT_RULE = "secret-in-commit"

const URL_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:([^\s/@'"]{6,})@/gi

/** The passwords in the web addresses on a line (user:password@host). */
function urlPasswords(line: string): string[] {
  return [...line.matchAll(URL_PASSWORD)].map((m) => m[1]!)
}

/**
 * Whether a password in a web address is a placeholder, not a value: <PASSWORD>, $VAR, ${VAR}, %VAR%, {{var}}, ***,
 * REPLACE_WITH_..., YOUR_..., changeme, example, xxx, or a word that only names what goes there (password, secret).
 */
export function isPlaceholder(p: string): boolean {
  const v = p.trim()
  if (/^[<$*%{[]/.test(v)) return true
  if (/^(?:replace[_-]?(?:with|me)|change[_-]?me|your[_-]|insert[_-]|enter[_-]|put[_-]|placeholder)/i.test(v)) return true
  if (/^(?:password|passwd|pass|pwd|secret|example|dummy|redacted|hidden|changeme|xxx+|\.\.\.+)$/i.test(v)) return true
  // One character over and over (xxxxxx, ******, ......).
  return /^(.)\1+$/.test(v)
}

// E-093: a number that could be a real payment card is refused too (only the file and line are named).
const KINDS: Array<{ kind: string; re: RegExp; test?: (line: string) => boolean }> = [
  { kind: "a card number", re: /\d{4}/, test: hasRealCard },
  { kind: "a private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "an Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  // Not an Anthropic key, which the line above names.
  { kind: "an OpenAI API key", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: "a GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/ },
  { kind: "a Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{20,}/ },
  { kind: "an AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "a password in a web address", re: URL_PASSWORD, test: (line) => urlPasswords(line).some((p) => !isPlaceholder(p)) },
]

const matches = (k: (typeof KINDS)[number], line: string) => (k.test ? k.test(line) : k.re.test(line))

export interface Found {
  file: string
  kind: string
  /** D-058: the line in the file, where the diff says (new files and hunks do; a bare diff does not). */
  line?: number
  /** For a push: the commit that adds it (short id), since the line is that commit's version of the file. */
  commit?: string
  /** O59: for a push, the branch that sends it. */
  branch?: string
}

/** Whether a shell command makes a commit (a git commit anywhere in it, chained or not). */
export function makesCommit(tool: string, input: Record<string, unknown>): boolean {
  if (tool !== "Bash" && tool !== "PowerShell") return false
  return typeof input.command === "string" && /\bgit\b[^;&|\n]*\bcommit\b/.test(input.command)
}

/**
 * git, its own options (-C <path>, -c <name=value>, --no-pager, quoted or not), then the subcommand: push only where
 * push is the subcommand, so a commit message that says "push" is not a push.
 */
const GIT_PUSH = /\bgit(?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)|--?[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\s;&|]+))?))*\s+push\b([^;&|\n]*)/g

/** Whether a shell command pushes (D-058). */
export function makesPush(tool: string, input: Record<string, unknown>): boolean {
  if (tool !== "Bash" && tool !== "PowerShell") return false
  return typeof input.command === "string" && pushArgs(input.command).length > 0
}

/** Each git push in a command, as its words after push (redirections left out). */
export function pushArgs(command: string): string[][] {
  return pushes(command).map((p) => p.words)
}

/** Each git push in a command: its words after push, and the folder git -C names, if it names one. */
export function pushes(command: string): Array<{ words: string[]; dir?: string }> {
  return [...command.matchAll(GIT_PUSH)].map((m) => {
    const words = (m[1]!.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
      .map((w) => w.replace(/^["']|["']$/g, ""))
      .filter((w) => !/^\d*>/.test(w) && !/^>/.test(w))
    const c = /\s-C\s+("[^"]*"|'[^']*'|[^\s;&|]+)/.exec(m[0].slice(0, m[0].length - m[1]!.length))
    return { words, ...(c ? { dir: c[1]!.replace(/^["']|["']$/g, "") } : {}) }
  })
}

/** A folder from git -C, from the session's folder; a Git Bash path (/c/dev/x) as Windows has it. */
function pushDir(cwd: string, dir: string | undefined): string {
  if (!dir) return cwd
  const win = process.platform === "win32" ? dir.replace(/^\/([a-zA-Z])\//, "$1:/") : dir
  return path.resolve(cwd, win)
}

export interface PushTarget {
  /** The local commit or branch sent. */
  local: string
  remote: string
  /** The branch it goes to on the remote. */
  branch: string
}

/**
 * What a push sends: the remote and each local ref with the remote branch it goes to. With no refspec, the current
 * branch to its upstream (or the same name). Undefined when the push sends more than named refs (--all, --mirror,
 * --tags, a pattern), so the caller reads every branch that remote has not got.
 */
export function pushTargets(words: string[], current: string | undefined, upstream: { remote: string; branch: string } | undefined): { remote: string; targets: PushTarget[] } | { remote: string; all: true } {
  const flagsWithValue = new Set(["--repo", "--receive-pack", "--exec", "-o", "--push-option", "--signed"])
  const rest: string[] = []
  let all = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (w === "--all" || w === "--mirror" || w === "--tags" || w === "--branches") all = true
    if (flagsWithValue.has(w)) i++
    else if (!w.startsWith("-")) rest.push(w)
  }
  const remote = rest[0] ?? upstream?.remote ?? "origin"
  if (all) return { remote, all: true }
  const specs = rest.slice(1)
  if (!specs.length) {
    if (!current) return { remote, all: true }
    return { remote, targets: [{ local: current, remote, branch: upstream && upstream.remote === remote ? upstream.branch : current }] }
  }
  const targets: PushTarget[] = []
  for (const raw of specs) {
    const spec = raw.replace(/^\+/, "")
    if (spec.includes("*")) return { remote, all: true }
    const [src, dst] = spec.includes(":") ? [spec.slice(0, spec.indexOf(":")), spec.slice(spec.indexOf(":") + 1)] : [spec, spec]
    // ":branch" deletes a remote branch: nothing is sent. HEAD means the current branch's name there.
    if (!src) continue
    const local = src
    const branch = (dst || src).replace(/^refs\/heads\//, "")
    targets.push({ local, remote, branch: branch === "HEAD" ? (current ?? "HEAD") : branch })
  }
  return { remote, targets }
}

/** What a diff adds that looks like a secret: the file, the kind and the line, once for each file and kind. */
export function secretsInDiff(diff: string): Found[] {
  const out: Found[] = []
  let file = ""
  let at: number | undefined
  let commit: string | undefined
  for (const line of diff.split(/\r?\n/)) {
    // A push's log marks where each commit starts (COMMIT_MARK and its short id).
    if (line.startsWith(COMMIT_MARK)) {
      commit = line.slice(COMMIT_MARK.length).trim() || undefined
      continue
    }
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "")
      at = undefined
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      at = Number(hunk[1])
      continue
    }
    if (line.startsWith("-") || line.startsWith("\\")) continue
    const n = at
    if (at !== undefined) at++
    if (!line.startsWith("+")) continue
    for (const k of KINDS)
      if (matches(k, line.slice(1)) && !out.some((f) => f.file === file && f.kind === k.kind))
        out.push({ file, kind: k.kind, ...(n !== undefined ? { line: n } : {}), ...(commit ? { commit } : {}) })
  }
  return out
}

/** Starts each commit in a push's log, with its short id after it. */
const COMMIT_MARK = "\u0000commit "

/** The same for a whole new file's text. */
export function secretsInFile(file: string, text: string): Found[] {
  const lines = text.split(/\r?\n/)
  return KINDS.flatMap((k) => {
    const i = lines.findIndex((l) => matches(k, l))
    // A pattern across lines (none today) is still found, without a line.
    return i >= 0 ? [{ file, kind: k.kind, line: i + 1 }] : !k.test && k.re.test(text) ? [{ file, kind: k.kind }] : []
  })
}

export type Git = (cwd: string, args: string[]) => Promise<string>

/** O59: the repository a folder is in (its top), or the folder itself when git cannot say. */
export async function repoTop(cwd: string, run: Git = git): Promise<string> {
  return run(cwd, ["rev-parse", "--show-toplevel"]).then((s) => s.trim() || cwd, () => cwd)
}

export const git: Git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      // Never a credential prompt: asking a remote what it has (ls-remote) fails rather than waits.
      { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (e, stdout) => (e ? reject(e) : resolve(String(stdout))),
    )
  })

/** A new file larger than this is not read (a secret is in text, and the commit would be odd anyway). */
const MAX_NEW_FILE = 1024 * 1024
const MAX_NEW_FILES = 2000

/**
 * What the commit in `command` would add, scanned. Staged changes; with -a or --all, every change to tracked files;
 * and when the same command also runs `git add`, which has not run yet, every change and every new file git would
 * pick up. Throws when it cannot read them, so the caller asks a person.
 */
export async function scanCommit(cwd: string, command: string, run: Git = git): Promise<Found[]> {
  const found = makesCommit("Bash", { command }) ? await scanStaged(cwd, command, run) : []
  // D-058: and what each push in the same command would send: the commits it sends, nothing on other branches.
  for (const p of pushes(command))
    for (const part of await pushedLogs(pushDir(cwd, p.dir), p.words, run))
      for (const f of secretsInDiff(part.log))
        if (!found.some((x) => x.file === f.file && x.kind === f.kind)) found.push(part.branch ? { ...f, branch: part.branch } : f)
  return found
}

/**
 * The commits a push sends, one log for each branch it sends (-U0, each commit marked with its short id), with that
 * branch. O59 (owner, 27 Nov): judged only on what each branch sends, from what the remote has now: its branch's commit
 * read freshly (git ls-remote), so a stale remote-tracking ref counts nothing the remote already has. A branch the
 * remote has not got sends what that remote has nowhere; a remote that cannot be asked falls back to its tracking ref,
 * then to what that remote has nowhere (more read, never less). An empty range sends nothing and finds nothing.
 */
async function pushedLogs(cwd: string, words: string[], run: Git): Promise<Array<{ branch?: string; log: string }>> {
  const quiet = (args: string[]) => run(cwd, args).then((s) => s.trim(), () => undefined)
  const current = await quiet(["symbolic-ref", "--quiet", "--short", "HEAD"])
  const up = await quiet(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  const slash = up ? up.indexOf("/") : -1
  const upstream = up && slash > 0 ? { remote: up.slice(0, slash), branch: up.slice(slash + 1) } : undefined
  const t = pushTargets(words, current, upstream)
  const log = ["-c", "core.quotepath=off", "log", "-p", "--no-color", "--no-ext-diff", "-U0", "--format=%x00commit %h"]
  // A remote name that is a path or an address: no remote-tracking refs, so what no remote has.
  const named = /^[\w.-]+$/.test(t.remote)
  const remoteRefs = named ? `--remotes=${t.remote}` : "--remotes"
  if ("all" in t) return [{ log: await run(cwd, [...log, "--branches", "--not", remoteRefs]) }]
  const out: Array<{ branch?: string; log: string }> = []
  for (const target of t.targets) {
    const base = await remoteHas(cwd, target.remote, target.branch, run)
    let range: string[]
    if (base.kind === "commit") range = [`${base.sha}..${target.local}`]
    else if (base.kind === "none") range = [target.local, "--not", remoteRefs]
    else {
      // Not answered: the tracking ref if there is one, otherwise what that remote has nowhere.
      const there = `refs/remotes/${target.remote}/${target.branch}`
      const known = named && (await quiet(["rev-parse", "--verify", "--quiet", there])) !== undefined
      range = known ? [`${there}..${target.local}`] : [target.local, "--not", remoteRefs]
    }
    const branch = target.local === "HEAD" || /^[0-9a-f]{7,64}$/.test(target.local) ? current : target.local
    out.push({ ...(branch ? { branch } : {}), log: await run(cwd, [...log, ...range, "--"]) })
  }
  return out
}

/**
 * What a remote's branch is now: its commit, when this repository has that commit too; none when the remote has no
 * such branch; unknown when the remote cannot be asked, or is ahead with commits not here.
 */
async function remoteHas(
  cwd: string,
  remote: string,
  branch: string,
  run: Git,
): Promise<{ kind: "commit"; sha: string } | { kind: "none" } | { kind: "unknown" }> {
  let listed: string
  try {
    listed = await run(cwd, ["ls-remote", "--heads", "--", remote, `refs/heads/${branch}`])
  } catch {
    return { kind: "unknown" }
  }
  const sha = listed.trim().split(/\s+/)[0] ?? ""
  if (!sha) return { kind: "none" }
  if (!/^[0-9a-f]{40,64}$/.test(sha)) return { kind: "unknown" }
  const here = await run(cwd, ["cat-file", "-e", `${sha}^{commit}`]).then(() => true, () => false)
  return here ? { kind: "commit", sha } : { kind: "unknown" }
}

/**
 * What the commit in `command` would add: the diff (-U0, paths from the repository's top) and, when the same command
 * also runs `git add`, the untracked files git would pick up (paths from cwd). D-062 reads the same.
 */
export async function commitAdditions(
  cwd: string,
  command: string,
  run: Git = git,
): Promise<{ diff: string; untracked: string[] }> {
  const adds = /\bgit\b[^;&|\n]*\badd\b/.test(command)
  const all = adds || /\bcommit\b[^;&|\n]*(?:\s-[A-Za-z]*a[A-Za-z]*\b|\s--all\b)/.test(command)
  const base = ["-c", "core.quotepath=off", "diff", "--no-color", "--no-ext-diff", "-U0"]
  let diff: string
  if (all) {
    // HEAD is missing before the first commit: then everything staged is what is new.
    const hasHead = await run(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(
      () => true,
      () => false,
    )
    diff = await run(cwd, [...base, ...(hasHead ? ["HEAD"] : ["--cached"])])
  } else diff = await run(cwd, [...base, "--cached"])
  const untracked = adds
    ? (await run(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]))
        .split("\0")
        .filter(Boolean)
        .slice(0, MAX_NEW_FILES)
    : []
  return { diff, untracked }
}

async function scanStaged(cwd: string, command: string, run: Git): Promise<Found[]> {
  const { diff, untracked } = await commitAdditions(cwd, command, run)
  const found = secretsInDiff(diff)
  for (const rel of untracked) {
    const abs = path.join(cwd, rel)
    try {
      const st = fs.lstatSync(abs)
      if (!st.isFile() || st.size > MAX_NEW_FILE) continue
      for (const f of secretsInFile(rel, fs.readFileSync(abs, "utf8")))
        if (!found.some((x) => x.file === f.file && x.kind === f.kind)) found.push(f)
    } catch {
      // gone, or not readable: not something this commit can take either
    }
  }
  return found
}

/** The refusal, naming each kind and file, never the value. */
export function secretReason(found: Found[]): string {
  const list = found
    .slice(0, 5)
    .map((f) => `${f.kind} in ${f.file || "a staged file"}${f.line ? `, line ${f.line}` : ""}${f.commit ? ` of commit ${f.commit}` : ""}${f.branch ? ` on branch ${f.branch}` : ""}`)
    .join("; ")
  return `This would commit or push what looks like a secret (${list}${found.length > 5 ? `; and ${found.length - 5} more` : ""}). Take it out, or keep it in a file git ignores, and commit again. If it is not a real secret, you can allow it once in Codehouse: Settings, Safety, Held for secrets.`
}
