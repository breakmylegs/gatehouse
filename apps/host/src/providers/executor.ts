import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { sanitiseEnv } from "@gatehouse/shared"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { inputHash } from "./gate.js"
import type { GateVerdict, ToolCall } from "./types.js"

/**
 * Codehouse's own tool executor for a loop provider (S-03, ADR 0008). It runs a call only with the gate's allow for that
 * call, and only the input the allow carries, checked against its hash, so an input changed after the gate never
 * runs (T-10). What a tool returns is redacted and marked untrusted before it goes back to the model (invariant 12,
 * ADR 0007). Tool inputs have the shape of the Claude Code tool of the same kind.
 */

export interface ToolOutcome {
  ok: boolean
  output: string
  untrusted: true
}

export class ExecutorRefused extends Error {}

export interface ExecutorDeps {
  workspaceRoot: string
  redact: (text: string) => string
  /** The shell: PowerShell 7 when installed, Windows PowerShell otherwise. */
  shell?: { exe: string; args: string[] }
  fetchFn?: typeof fetch
}

const MAX_OUTPUT = 30_000
const MAX_READ_LINES = 2000
const MAX_FILE_BYTES = 1_000_000
const MAX_MATCHES = 200
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage"])

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "") throw new ExecutorRefused(`${name} is missing.`)
  return v
}
const cap = (s: string) =>
  s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n[cut at ${MAX_OUTPUT} characters]` : s

/** PowerShell 7 if it is on the PATH, else the Windows PowerShell every Windows has. */
export function defaultShell(): { exe: string; args: string[] } {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]
  try {
    execFileSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"], {
      windowsHide: true,
      timeout: 15_000,
    })
    return { exe: "pwsh", args }
  } catch {
    return { exe: "powershell.exe", args }
  }
}

export class ToolExecutor {
  readonly #d: ExecutorDeps

  constructor(deps: ExecutorDeps) {
    this.#d = deps
  }

  #path(p: unknown): string {
    return path.resolve(this.#d.workspaceRoot, str(p, "file_path"))
  }

  /** Runs the call with the input the gate allowed, or refuses. Never throws for a tool's own failure. */
  async run(call: ToolCall, verdict: GateVerdict): Promise<ToolOutcome> {
    if (verdict.kind !== "allow") throw new ExecutorRefused("The call was not allowed.")
    if (verdict.callId !== call.callId) throw new ExecutorRefused("The allow is for another call.")
    if (inputHash(verdict.input) !== verdict.inputHash)
      throw new ExecutorRefused("The input is not the one that was allowed.")
    const input = verdict.input
    let ok = true
    let output: string
    try {
      output = await this.#tool(call.tool, input)
    } catch (e) {
      if (e instanceof ExecutorRefused) throw e
      ok = false
      output = (e as Error).message
    }
    return { ok, output: this.#d.redact(cap(output)), untrusted: true }
  }

  async #tool(tool: ToolCall["tool"], input: Record<string, unknown>): Promise<string> {
    switch (tool) {
      case "read": {
        const file = this.#path(input.file_path)
        if (fs.statSync(file).size > MAX_FILE_BYTES * 10)
          throw new Error("The file is too big to read.")
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
        const from = Math.max(0, Number(input.offset ?? 1) - 1)
        const n = Math.min(MAX_READ_LINES, Number(input.limit ?? MAX_READ_LINES))
        return lines
          .slice(from, from + n)
          .map((l, i) => `${from + i + 1}\t${l}`)
          .join("\n")
      }
      case "write": {
        const file = this.#path(input.file_path)
        if (typeof input.content !== "string") throw new ExecutorRefused("content is missing.")
        fs.mkdirSync(path.dirname(file), { recursive: true })
        await writeFileAtomic(file, input.content)
        return `Wrote ${input.content.length} characters to ${file}.`
      }
      case "edit": {
        const file = this.#path(input.file_path)
        const from = str(input.old_string, "old_string")
        if (typeof input.new_string !== "string")
          throw new ExecutorRefused("new_string is missing.")
        const text = fs.readFileSync(file, "utf8")
        const count = text.split(from).length - 1
        if (count === 0) throw new Error("old_string was not found in the file.")
        if (count > 1 && input.replace_all !== true)
          throw new Error(
            `old_string is in the file ${count} times; give more of the text, or replace_all.`,
          )
        await writeFileAtomic(file, text.split(from).join(input.new_string))
        return `Edited ${file} (${input.replace_all === true ? count : 1} change${count === 1 ? "" : "s"}).`
      }
      case "glob": {
        const base = path.resolve(
          this.#d.workspaceRoot,
          typeof input.path === "string" ? input.path : ".",
        )
        const found = fs
          .globSync(str(input.pattern, "pattern"), { cwd: base })
          .filter((p) => !p.split(/[\\/]/).some((part) => SKIP_DIRS.has(part)))
          .slice(0, 500)
        return found.length ? found.map((p) => path.join(base, p)).join("\n") : "No files matched."
      }
      case "grep": {
        const re = new RegExp(str(input.pattern, "pattern"), input["-i"] === true ? "i" : "")
        const base = path.resolve(
          this.#d.workspaceRoot,
          typeof input.path === "string" ? input.path : ".",
        )
        const out: string[] = []
        const walk = (dir: string) => {
          for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
            if (out.length >= MAX_MATCHES) return
            const full = path.join(dir, d.name)
            if (d.isDirectory()) {
              if (!SKIP_DIRS.has(d.name)) walk(full)
            } else if (d.isFile() && fs.statSync(full).size <= MAX_FILE_BYTES) {
              const lines = fs.readFileSync(full, "utf8").split(/\r?\n/)
              lines.forEach((l, i) => {
                if (out.length < MAX_MATCHES && re.test(l))
                  out.push(`${full}:${i + 1}: ${l.slice(0, 300)}`)
              })
            }
          }
        }
        if (fs.statSync(base).isDirectory()) walk(base)
        else
          fs.readFileSync(base, "utf8")
            .split(/\r?\n/)
            .forEach((l, i) => re.test(l) && out.push(`${base}:${i + 1}: ${l}`))
        return out.length ? out.join("\n") : "No matches."
      }
      case "shell":
        return await this.#shell(str(input.command, "command"), Number(input.timeout ?? 120_000))
      case "webFetch":
        return await this.#fetch(str(input.url, "url"))
      default:
        throw new ExecutorRefused(`Codehouse does not run ${tool} calls yet.`)
    }
  }

  /** A command in the workspace folder, with no credential in its environment, stopped with its children on time. */
  #shell(command: string, timeoutMs: number): Promise<string> {
    const sh = this.#d.shell ?? defaultShell()
    const limit = Math.min(Math.max(1000, timeoutMs || 120_000), 600_000)
    return new Promise((resolve, reject) => {
      const child = spawn(sh.exe, [...sh.args, command], {
        cwd: this.#d.workspaceRoot,
        env: sanitiseEnv(process.env) as NodeJS.ProcessEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let out = ""
      child.stdout.on("data", (d: Buffer) => (out = cap(out + d.toString())))
      child.stderr.on("data", (d: Buffer) => (out = cap(out + d.toString())))
      const timer = setTimeout(() => {
        if (child.pid)
          spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true })
        reject(
          new Error(
            `The command did not finish in ${Math.round(limit / 1000)} seconds and was stopped.`,
          ),
        )
      }, limit)
      child.on("error", (e) => {
        clearTimeout(timer)
        reject(e)
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve(`${out}${code ? `\n[exit code ${code}]` : ""}`)
      })
    })
  }

  async #fetch(raw: string): Promise<string> {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new ExecutorRefused("Only web addresses can be fetched.")
    const res = await (this.#d.fetchFn ?? fetch)(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    })
    const text = (await res.text()).slice(0, MAX_FILE_BYTES)
    const plain = /html/i.test(res.headers.get("content-type") ?? "")
      ? text
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
      : text
    return `${res.status} ${url.href}\n${plain}`
  }
}
