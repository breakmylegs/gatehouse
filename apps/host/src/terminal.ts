import { spawn, execFile, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import { sanitiseEnv, uuidv7, type Verdict } from "@gatehouse/shared"
import type { HostAudit } from "./hostaudit.js"

/** Longest command the pane accepts. */
export const MAX_COMMAND = 8000
/** Output beyond this, per command, is dropped with a note, so a runaway command cannot flood the window. */
export const MAX_OUTPUT = 2_000_000

export class TerminalError extends Error {}

export interface TerminalDeps {
  audit: HostAudit
  /** True while the kill switch is engaged: nothing runs. */
  killed: () => boolean
  /** The policy hash for the audit record. */
  policyHash: () => string
  log: (line: string) => void
  /** The shell. pwsh when it is installed, else Windows PowerShell; tests pass node. */
  shell?: { file: string; args: (command: string) => string[] }
  env?: NodeJS.ProcessEnv
}

interface Running {
  runId: string
  child: ChildProcess
  bytes: number
}

/**
 * The terminal pane: your own commands, in a session's folder, one at a time per session. It is not a pseudo
 * console (that needs a native addon, which the project avoids), so programs that ask questions as they run get no
 * answer; everything else works and its output streams to the window.
 *
 * These are your commands, not Claude's: they do not pass the Approver, the same as a PowerShell window you open
 * yourself. They are still recorded (redacted) in the audit log, the kill switch stops them and refuses new ones,
 * and only the desktop can send them.
 */
export class TerminalManager extends EventEmitter {
  readonly #deps: TerminalDeps
  readonly #running = new Map<string, Running>()

  constructor(deps: TerminalDeps) {
    super()
    this.#deps = deps
  }

  isRunning(sessionId: string): boolean {
    return this.#running.has(sessionId)
  }

  async run(sessionId: string, cwd: string, command: string): Promise<{ runId: string }> {
    const text = command.trim()
    if (!text) throw new TerminalError("Type a command first.")
    if (text.length > MAX_COMMAND) throw new TerminalError("That command is too long.")
    if (this.#deps.killed())
      throw new TerminalError("The kill switch is engaged. Re-arm it before running commands.")
    if (this.#running.has(sessionId))
      throw new TerminalError("A command is still running here. Stop it or wait for it to finish.")
    if (!fs.existsSync(cwd)) throw new TerminalError(`The folder ${cwd} is not there any more.`)

    const runId = uuidv7()
    const verdict: Verdict = {
      outcome: "allow",
      ruleId: "terminal-command",
      reason:
        "You ran this yourself in the terminal pane. Your own commands do not pass the Approver.",
      risk: 0,
      decidedBy: "human-desktop",
      policyHash: this.#deps.policyHash(),
    }
    // Recorded first, without a cwd, so a policy replay never mistakes it for one of Claude's calls.
    const written = await this.#deps.audit.record({
      session: sessionId,
      event: "terminal_command",
      channel: "desktop",
      tool: "terminal",
      input: { command: text, folder: cwd },
      verdict,
      latencyMs: 0,
    })
    if (!written)
      throw new TerminalError(
        "The command could not be recorded in the audit log, so it did not run.",
      )

    const shell = this.#deps.shell ?? defaultShell()
    const child = spawn(shell.file, shell.args(text), {
      cwd,
      env: sanitiseEnv(this.#deps.env ?? process.env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const run: Running = { runId, child, bytes: 0 }
    this.#running.set(sessionId, run)
    const forward = (stream: "out" | "err") => (chunk: Buffer) => {
      if (run.bytes >= MAX_OUTPUT) return
      run.bytes += chunk.length
      const text =
        run.bytes >= MAX_OUTPUT
          ? `${chunk.toString("utf8")}\n[more output was dropped: over ${MAX_OUTPUT / 1_000_000} MB]\n`
          : chunk.toString("utf8")
      this.emit("output", { sessionId, runId, stream, text })
    }
    child.stdout?.on("data", forward("out"))
    child.stderr?.on("data", forward("err"))
    child.on("error", (e) => {
      this.emit("output", { sessionId, runId, stream: "err", text: `${e.message}\n` })
    })
    child.on("close", (code, signal) => {
      if (this.#running.get(sessionId)?.runId === runId) this.#running.delete(sessionId)
      this.emit("exit", { sessionId, runId, code, ...(signal ? { signal } : {}) })
    })
    return { runId }
  }

  /** Stops the command running in a session, and anything it started. */
  stop(sessionId: string): boolean {
    const run = this.#running.get(sessionId)
    if (!run) return false
    killTree(run.child)
    return true
  }

  /** The kill switch: every running command stops. */
  stopAll(): void {
    for (const id of [...this.#running.keys()]) this.stop(id)
  }
}

function defaultShell(): { file: string; args: (c: string) => string[] } {
  const args = (c: string) => ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", c]
  return { file: process.platform === "win32" ? pwshOrWindowsPowerShell() : "pwsh", args }
}

let shellFile: string | undefined
function pwshOrWindowsPowerShell(): string {
  if (shellFile) return shellFile
  const dirs = (process.env.PATH ?? "").split(";").filter(Boolean)
  shellFile = dirs.some((d) => fs.existsSync(`${d}\\pwsh.exe`)) ? "pwsh.exe" : "powershell.exe"
  return shellFile
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === "win32")
    execFile(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { windowsHide: true },
      () => undefined,
    )
  else child.kill("SIGKILL")
}
