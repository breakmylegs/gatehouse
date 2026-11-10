import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * Secrets in a commit (backlog G22; "a plain in-repo scanner, never gitleaks", the owner's rule). Before a session's
 * `git commit` runs, the floor reads the lines the commit would add and refuses it when one holds a key or a private
 * key. Only patterns that are almost never anything else are used, so ordinary code is not stopped; the refusal names
 * the kind and the file, never the value. When it cannot check, the call goes to a person instead (fail closed).
 * Commits you make yourself, in your own terminal, are yours and are not scanned.
 */
export const SECRET_IN_COMMIT_RULE = "secret-in-commit"

const KINDS: Array<{ kind: string; re: RegExp }> = [
  { kind: "a private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "an Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "an OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: "a GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/ },
  { kind: "a Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{20,}/ },
  { kind: "an AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "a password in a web address", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]{6,}@/i },
]

export interface Found {
  file: string
  kind: string
}

/** Whether a shell command makes a commit (a git commit anywhere in it, chained or not). */
export function makesCommit(tool: string, input: Record<string, unknown>): boolean {
  if (tool !== "Bash" && tool !== "PowerShell") return false
  return typeof input.command === "string" && /\bgit\b[^;&|\n]*\bcommit\b/.test(input.command)
}

/** What a diff adds that looks like a secret: the file and the kind, once each. */
export function secretsInDiff(diff: string): Found[] {
  const out: Found[] = []
  let file = ""
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "")
      continue
    }
    if (!line.startsWith("+")) continue
    for (const k of KINDS)
      if (k.re.test(line) && !out.some((f) => f.file === file && f.kind === k.kind))
        out.push({ file, kind: k.kind })
  }
  return out
}

/** The same for a whole new file's text. */
export function secretsInFile(file: string, text: string): Found[] {
  return KINDS.filter((k) => k.re.test(text)).map((k) => ({ file, kind: k.kind }))
}

type Git = (cwd: string, args: string[]) => Promise<string>

const git: Git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 * 1024 },
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
  const found = secretsInDiff(diff)
  if (adds) {
    const untracked = (await run(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]))
      .split("\0")
      .filter(Boolean)
      .slice(0, MAX_NEW_FILES)
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
  }
  return found
}

/** The refusal, naming each kind and file, never the value. */
export function secretReason(found: Found[]): string {
  const list = found
    .slice(0, 5)
    .map((f) => `${f.kind} in ${f.file || "a staged file"}`)
    .join("; ")
  return `This commit would add what looks like a secret (${list}${found.length > 5 ? `; and ${found.length - 5} more` : ""}). Take it out, or keep it in a file git ignores, and commit again. If it is not a real secret, commit it yourself in the Terminal.`
}
