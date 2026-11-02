import { randomBytes } from "node:crypto"
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { EventEmitter } from "node:events"
import net from "node:net"
import type { Readable, Writable } from "node:stream"
import { sanitiseEnv } from "@gatehouse/shared"

export type ApproverState = "stopped" | "starting" | "up" | "down"

export interface Backoff {
  initialMs: number
  maxMs: number
  factor: number
  /** A process that stayed up this long starts the back-off again from the beginning. */
  resetAfterMs: number
}

export const DEFAULT_BACKOFF: Backoff = {
  initialMs: 500,
  maxMs: 30_000,
  factor: 2,
  resetAfterMs: 30_000,
}

type Child = ChildProcessByStdio<Writable, Readable, Readable>

export interface ApproverProcessOptions {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  token: string
  port: number
  readyTimeoutMs?: number
  backoff?: Partial<Backoff>
  onLog?: (line: string) => void
}

export interface ApproverProcessEvents {
  ready: [{ pid: number; port: number; attempt: number }]
  exit: [{ code: number | null; signal: string | null; restartInMs: number | undefined }]
  restarting: [{ attempt: number; delayMs: number }]
}

/** A fresh random bearer token for one Host launch. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

/** A port the operating system has just said is free. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Runs the Approver as a child process and keeps it running: it is restarted after a crash with
 * exponential back-off, and it can be stopped for good. While it is down the Host's ApproverClient
 * escalates every request, so a crash never opens anything up.
 */
export class ApproverProcess extends EventEmitter<ApproverProcessEvents> {
  readonly #opts: ApproverProcessOptions
  readonly #backoff: Backoff
  #child: Child | undefined
  #state: ApproverState = "stopped"
  #stopping = false
  #attempt = 0
  #restartTimer: NodeJS.Timeout | undefined
  #upSince = 0

  constructor(opts: ApproverProcessOptions) {
    super()
    this.#opts = opts
    this.#backoff = { ...DEFAULT_BACKOFF, ...opts.backoff }
  }

  get state(): ApproverState {
    return this.#state
  }

  get pid(): number | undefined {
    return this.#child?.pid
  }

  get url(): string {
    return `http://127.0.0.1:${this.#opts.port}/mcp`
  }

  get token(): string {
    return this.#opts.token
  }

  /** Starts the first process. Rejects if it does not become ready. Later crashes restart on their own. */
  async start(): Promise<void> {
    if (this.#state !== "stopped") throw new Error("already started")
    this.#stopping = false
    this.#attempt = 0
    try {
      await this.#launch()
    } catch (e) {
      await this.stop()
      throw e
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true
    clearTimeout(this.#restartTimer)
    const child = this.#child
    this.#child = undefined
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve())
        // Ask for a clean stop first (closing stdin lets the Approver close its PowerShell worker), then insist.
        child.stdin.end()
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        }, 4000).unref()
      })
    }
    this.#state = "stopped"
  }

  #launch(): Promise<void> {
    this.#state = "starting"
    this.#attempt++
    const attempt = this.#attempt
    const env = {
      ...sanitiseEnv(process.env),
      ...this.#opts.env,
      GATEHOUSE_APPROVER_TOKEN: this.#opts.token,
      GATEHOUSE_APPROVER_PORT: String(this.#opts.port),
      GATEHOUSE_EXIT_ON_STDIN_CLOSE: "1",
    }
    const child = spawn(this.#opts.command, this.#opts.args, {
      cwd: this.#opts.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    child.stdin.on("error", () => undefined)
    this.#child = child
    return new Promise<void>((resolve, reject) => {
      let ready = false
      let buffer = ""
      const timer = setTimeout(() => {
        if (!ready) {
          child.kill()
          reject(new Error("The Approver did not become ready in time"))
        }
      }, this.#opts.readyTimeoutMs ?? 30_000)

      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk
        for (;;) {
          const nl = buffer.indexOf("\n")
          if (nl < 0) break
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          try {
            const msg = JSON.parse(line) as { event?: string; port?: number; pid?: number }
            if (msg.event === "listening" && !ready) {
              ready = true
              clearTimeout(timer)
              this.#state = "up"
              this.#upSince = Date.now()
              this.emit("ready", {
                pid: child.pid ?? 0,
                port: msg.port ?? this.#opts.port,
                attempt,
              })
              resolve()
            }
          } catch {
            this.#opts.onLog?.(line)
          }
        }
      })
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split("\n"))
          if (line.trim() !== "") this.#opts.onLog?.(line.trim())
      })
      child.on("error", (e) => {
        clearTimeout(timer)
        if (!ready) reject(e)
      })
      child.on("exit", (code, signal) => {
        clearTimeout(timer)
        if (this.#child !== child) return // an old process, or we are stopping
        this.#child = undefined
        if (!ready) {
          reject(new Error(`The Approver exited before it was ready (code ${code})`))
          return
        }
        this.#state = "down"
        if (this.#stopping) {
          this.emit("exit", { code, signal, restartInMs: undefined })
          return
        }
        if (Date.now() - this.#upSince > this.#backoff.resetAfterMs) this.#attempt = 0
        const delay = Math.min(
          this.#backoff.maxMs,
          this.#backoff.initialMs * this.#backoff.factor ** Math.max(0, this.#attempt - 1),
        )
        this.emit("exit", { code, signal, restartInMs: delay })
        this.#scheduleRestart(delay)
      })
    })
  }

  #scheduleRestart(delayMs: number): void {
    this.emit("restarting", { attempt: this.#attempt + 1, delayMs })
    this.#restartTimer = setTimeout(() => {
      if (this.#stopping) return
      this.#launch().catch((e) => {
        // The new process failed to start. Treat it like a crash and back off further.
        this.#opts.onLog?.(`restart failed: ${(e as Error).message}`)
        if (this.#stopping) return
        this.#state = "down"
        const delay = Math.min(
          this.#backoff.maxMs,
          this.#backoff.initialMs * this.#backoff.factor ** Math.max(0, this.#attempt - 1),
        )
        this.#scheduleRestart(delay)
      })
    }, delayMs)
  }
}
