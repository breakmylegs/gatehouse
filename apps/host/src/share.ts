/**
 * G40 (owner's connector items, 9 Nov): sharing a project and publishing it.
 *
 * Share as a zip: the files git would take (what .gitignore leaves out stays out), or, outside git, the folder without
 * its build and package folders. Left out as well: files named like secrets (.env and its kind, keys and certificates,
 * .npmrc, .netrc, cloud credentials), and any file whose text holds what the commit scan calls a secret (G22). A note in
 * the zip names what was left out and why, never a value. Audited.
 *
 * Publish: a deploy command you name in Settings, run by that host's own command line tool with its own sign-in
 * (Netlify, Vercel, Cloudflare, GitHub Pages and the like). It is your action from the window: audited first, refused
 * while the kill switch is engaged, in the session's folder, with no Anthropic credential in its environment, stopped
 * after ten minutes. Codehouse holds no host's credential. On Windows a tool installed as a .cmd file is run by cmd.exe
 * with the words from Settings only, and a word holding a character cmd.exe treats specially is refused.
 */
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { sanitiseEnv, type Verdict } from "@gatehouse/shared"
import { secretsInFile } from "./commit-scan.js"
import type { HostAudit } from "./hostaudit.js"
import { zip } from "./office.js"

export const MAX_FILES = 5000
export const MAX_TOTAL = 200 * 1024 * 1024
export const MAX_FILE = 50 * 1024 * 1024
/** Text larger than this is not read for secrets; it goes in or out by its name alone. */
const MAX_SCAN = 1024 * 1024

export class ShareError extends Error {}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "bin", "obj", ".venv", "venv", "__pycache__", ".next", ".turbo", "coverage", ".codehouse"])

/** Why a file's name alone keeps it out, or undefined. Examples and templates (.env.example) are kept. */
export function secretName(rel: string): string | undefined {
  const parts = rel.split("/")
  const base = parts.at(-1)!.toLowerCase()
  if (parts.slice(0, -1).some((p) => [".ssh", ".aws", ".azure", ".gnupg", ".docker"].includes(p.toLowerCase()))) return "a folder of credentials"
  if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample|template|dist|defaults?)$/.test(base)) return "an environment file"
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg)$/.test(base)) return "a key or certificate"
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(base) && !base.endsWith(".pub")) return "a private key"
  if ([".npmrc", ".pypirc", ".netrc", "_netrc", ".git-credentials", ".htpasswd", ".pgpass"].includes(base)) return "a file of tokens or passwords"
  if (/^(credentials|service[-_]?account.*|client_secret.*|secrets?)\.(json|ya?ml|toml|ini|txt)$/.test(base)) return "a credentials file"
  if (/\.tfstate(\.backup)?$/.test(base) || base === "terraform.tfvars") return "infrastructure state with secrets"
  return undefined
}

type Run = (cwd: string, args: string[]) => Promise<string>
const gitRun: Run = (cwd, args) =>
  new Promise((resolve, reject) => execFile("git", args, { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(String(out)))))

/** The project's files, from the folder: git's view when it is a repository, else the folder less build folders. */
export async function projectFiles(root: string, run: Run = gitRun): Promise<string[]> {
  try {
    const out = await run(root, ["-c", "core.quotepath=off", "ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    return out.split("\0").filter(Boolean).map((f) => f.replace(/\\/g, "/"))
  } catch {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length > MAX_FILES * 2) return
        if (e.isSymbolicLink()) continue
        const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join("/")
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name))
        } else if (e.isFile()) out.push(rel)
      }
    }
    walk(root)
    return out
  }
}

export interface SharePlan {
  files: string[]
  left: Array<{ file: string; why: string }>
  bytes: number
}

/** What a share takes and what it leaves out, and why. */
export async function planShare(root: string, run: Run = gitRun): Promise<SharePlan> {
  const files: string[] = []
  const left: SharePlan["left"] = []
  let bytes = 0
  for (const rel of await projectFiles(root, run)) {
    const abs = path.join(root, rel)
    let st: fs.Stats
    try {
      st = fs.lstatSync(abs)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    const byName = secretName(rel)
    if (byName) {
      left.push({ file: rel, why: byName })
      continue
    }
    if (st.size > MAX_FILE) {
      left.push({ file: rel, why: "larger than 50 MB" })
      continue
    }
    if (st.size <= MAX_SCAN) {
      const buf = fs.readFileSync(abs)
      // Text only: a file with a NUL byte in its start is taken as binary, by its name alone.
      if (!buf.subarray(0, 8000).includes(0)) {
        const found = secretsInFile(rel, buf.toString("utf8"))
        if (found.length) {
          left.push({ file: rel, why: `it holds ${found[0]!.kind}${found[0]!.line ? ` (line ${found[0]!.line})` : ""}` })
          continue
        }
      }
    }
    if (files.length >= MAX_FILES || bytes + st.size > MAX_TOTAL) {
      left.push({ file: rel, why: "past the zip's limit (5000 files, 200 MB)" })
      continue
    }
    files.push(rel)
    bytes += st.size
  }
  return { files, left, bytes }
}

/** The note that goes in the zip: what was left out and why, never a value. */
export function shareNote(project: string, plan: SharePlan): string {
  const lines = [`${project}, shared by Codehouse.`, "", `${plan.files.length} files are here.`]
  if (plan.left.length) {
    lines.push("", "Left out, so nothing secret is shared (ask the sender for what you need):")
    for (const l of plan.left.slice(0, 500)) lines.push(`- ${l.file}: ${l.why}`)
    if (plan.left.length > 500) lines.push(`- and ${plan.left.length - 500} more`)
  }
  return lines.join("\r\n") + "\r\n"
}

export const NOTE_NAME = "SHARED-BY-CODEHOUSE.txt"

/** The zip itself, the project's files under its folder name, with the note. */
export function shareZip(root: string, plan: SharePlan): Buffer {
  const project = path.basename(root)
  return zip([
    { name: `${project}/${NOTE_NAME}`, data: shareNote(project, plan) },
    ...plan.files.map((f) => ({ name: `${project}/${f}`, data: fs.readFileSync(path.join(root, f)) })),
  ])
}

export interface PublishSetting {
  name: string
  command: string
  args?: string[]
}

export interface PublishOutcome {
  exitCode: number | null
  timedOut: boolean
  output: string
}

/** Characters cmd.exe gives a meaning to, refused in a word it would read. */
const CMD_SPECIAL = /[&|<>^%!"`\r\n]/

/** The program and words for a publish: a .cmd or .bat tool on Windows through cmd.exe, refusing special characters. */
export function publishCommand(s: PublishSetting, platform = process.platform, resolve: (cmd: string) => string | undefined = whereIs): { file: string; args: string[] } {
  const words = [s.command, ...(s.args ?? [])]
  if (platform !== "win32") return { file: s.command, args: s.args ?? [] }
  const found = resolve(s.command) ?? s.command
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args: s.args ?? [] }
  const bad = words.find((w) => CMD_SPECIAL.test(w))
  if (bad !== undefined) throw new ShareError(`"${bad}" has a character cmd.exe treats specially, so Codehouse will not run it. Take it out of the command in Settings.`)
  const quote = (w: string) => (/[\s()]/.test(w) ? `"${w}"` : w)
  return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${[found, ...(s.args ?? [])].map(quote).join(" ")}"`] }
}

/** Where a command is on the PATH, with the endings Windows tries. */
function whereIs(cmd: string): string | undefined {
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : undefined
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const e of ["", ...exts]) {
      const p = path.join(dir, cmd + e)
      if (e && fs.existsSync(p)) return p
    }
  }
  return undefined
}

export interface ShareDeps {
  audit: HostAudit
  killed: () => boolean
  policyHash: () => string
  publishers: () => readonly PublishSetting[] | undefined
  redact: (s: string) => string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  run?: Run
  platform?: NodeJS.Platform
  resolve?: (cmd: string) => string | undefined
}

/** Sharing and publishing for the window, each audited first. */
export class Sharing {
  readonly #d: ShareDeps
  readonly #publishing = new Set<string>()
  constructor(d: ShareDeps) {
    this.#d = d
  }

  #verdict(reason: string): Verdict {
    return { outcome: "allow", ruleId: "share-publish", reason, risk: 0, decidedBy: "rules", policyHash: this.#d.policyHash() }
  }

  plan(root: string): Promise<SharePlan> {
    return planShare(root, this.#d.run)
  }

  async zip(sessionId: string, root: string): Promise<{ zip: Buffer; plan: SharePlan }> {
    const plan = await planShare(root, this.#d.run)
    const ok = await this.#d.audit.record({
      session: sessionId,
      event: "project_shared",
      channel: "desktop",
      tool: "share",
      input: { folder: root, files: plan.files.length, leftOut: plan.left.map((l) => ({ file: l.file, why: l.why })).slice(0, 200) },
      verdict: this.#verdict("You shared the project as a zip; files that could hold secrets were left out."),
      latencyMs: 0,
    })
    if (!ok) throw new ShareError("The share could not be recorded in the audit log, so no zip was made.")
    return { zip: shareZip(root, plan), plan }
  }

  async publish(sessionId: string, root: string, name: string): Promise<PublishOutcome> {
    if (this.#d.killed()) throw new ShareError("The kill switch is engaged. Re-arm it before publishing.")
    const s = this.#d.publishers()?.find((p) => p.name === name && p.command.trim())
    if (!s) throw new ShareError("No publish command has that name. Name one in Settings, Connectors, Publish.")
    if (this.#publishing.has(root)) throw new ShareError("A publish is already running for this project.")
    const cmd = publishCommand(s, this.#d.platform, this.#d.resolve)
    const ok = await this.#d.audit.record({
      session: sessionId,
      event: "project_published",
      channel: "desktop",
      tool: "publish",
      input: { folder: root, host: s.name, command: [s.command, ...(s.args ?? [])].join(" ") },
      verdict: this.#verdict(`You published the project with ${s.name}'s own tool. Your own actions do not pass the Approver.`),
      latencyMs: 0,
    })
    if (!ok) throw new ShareError("The publish could not be recorded in the audit log, so it did not run.")
    this.#publishing.add(root)
    try {
      return await new Promise<PublishOutcome>((resolve, reject) => {
        const child = spawn(cmd.file, cmd.args, { cwd: root, env: sanitiseEnv(this.#d.env ?? process.env) as NodeJS.ProcessEnv, windowsHide: true, shell: false, windowsVerbatimArguments: cmd.file.toLowerCase().endsWith("cmd.exe") })
        let output = ""
        const keep = (b: Buffer) => {
          output = (output + b.toString("utf8")).slice(-20_000)
        }
        child.stdout?.on("data", keep)
        child.stderr?.on("data", keep)
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          if (process.platform === "win32" && child.pid) spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
          else child.kill()
        }, this.#d.timeoutMs ?? 10 * 60_000)
        child.on("error", (e) => {
          clearTimeout(timer)
          reject(new ShareError(`${s.name}'s tool could not be started (${(e as NodeJS.ErrnoException).code ?? e.message}). Is it installed?`))
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          resolve({ exitCode: code, timedOut, output: this.#d.redact(output.replace(/\u001b\[[0-9;]*m/g, "")) })
        })
      })
    } finally {
      this.#publishing.delete(root)
    }
  }
}
