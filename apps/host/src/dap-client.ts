/**
 * G37 (owner's connector items, 9 Nov): a debugger through the Debug Adapter Protocol, with adapters you have
 * installed (debugpy for Python, js-debug for Node, netcoredbg for .NET; never Microsoft's vsdbg, and never the Chrome
 * DevTools Protocol). Off until you name an adapter in Settings, Connectors, Debug adapters. You, or Claude through the
 * Companion, start a program from the session's folder under it, set breakpoints, and step; every action is audited
 * with who took it, a start is refused while the kill switch is engaged, and what a stop shows (the stack and the top
 * frame's variables) is redacted before it leaves the Host. Nothing is evaluated in the program: no expressions, no
 * changing a variable.
 */
import { spawn, type ChildProcess } from "node:child_process"
import net from "node:net"
import path from "node:path"
import { sanitiseEnv } from "@gatehouse/shared"
import type { HostAudit } from "./hostaudit.js"
import { Framer, frame } from "./lsp-client.js"

export type AdapterKind = "python" | "node" | "dotnet" | "other"

export interface DebugAdapterSetting {
  name: string
  kind: AdapterKind
  command: string
  /** Arguments; "{port}" in one makes Codehouse choose a port and reach the adapter there on 127.0.0.1. */
  args?: string[]
}

export class DebugError extends Error {}

export interface Frame {
  name: string
  file?: string
  line: number
}
export interface Variable {
  name: string
  value: string
  type?: string
}
export interface DebugState {
  adapter: string
  program: string
  state: "starting" | "running" | "stopped" | "ended"
  reason?: string
  frames?: Frame[]
  variables?: Variable[]
  breakpoints: Record<string, number[]>
  output: string
}

export type Who = "desktop" | "companion"
export type StepKind = "continue" | "next" | "stepIn" | "stepOut" | "pause"

/** The launch request an adapter of this kind expects, for a program in the session's folder. */
export function launchArgs(kind: AdapterKind, program: string, args: string[], cwd: string): Record<string, unknown> {
  const base = { request: "launch", program, args, cwd }
  if (kind === "python") return { ...base, type: "python", name: "Codehouse", console: "internalConsole", justMyCode: true }
  if (kind === "node") return { ...base, type: "pwa-node", name: "Codehouse", console: "internalConsole" }
  if (kind === "dotnet") return { ...base, type: "coreclr", name: "Codehouse", stopAtEntry: false }
  return base
}

/** A free port on 127.0.0.1, for an adapter that listens. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}

async function connectWithRetry(port: number, until: number): Promise<net.Socket> {
  for (;;) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const sock = net.connect(port, "127.0.0.1")
        sock.once("connect", () => resolve(sock))
        sock.once("error", reject)
      })
    } catch (e) {
      if (Date.now() > until) throw new DebugError(`The debug adapter did not open its port (${(e as Error).message}).`)
      await new Promise((r) => setTimeout(r, 150))
    }
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/** One program under one adapter. */
export class DebugSession {
  #child: ChildProcess | undefined
  #write: (s: string) => void = () => undefined
  #seq = 1
  readonly #pending = new Map<number, Pending>()
  readonly #waiters: Array<{ event: string; resolve: (b: Record<string, unknown>) => void }> = []
  readonly state: DebugState
  #threadId: number | undefined
  #frameIds: number[] = []
  readonly #redact: (s: string) => string
  onChange: (s: DebugState) => void = () => undefined

  constructor(
    readonly setting: DebugAdapterSetting,
    readonly root: string,
    readonly program: string,
    private readonly o: { timeoutMs: number; env: NodeJS.ProcessEnv; redact: (s: string) => string },
  ) {
    this.#redact = o.redact
    this.state = { adapter: setting.name, program: path.relative(root, program).split(path.sep).join("/"), state: "starting", breakpoints: {}, output: "" }
  }

  async start(args: string[], breakpoints: Record<string, number[]>): Promise<void> {
    const usesPort = (this.setting.args ?? []).some((a) => a.includes("{port}"))
    const port = usesPort ? await freePort() : 0
    const argv = (this.setting.args ?? []).map((a) => a.replace(/\{port\}/g, String(port)))
    this.#child = spawn(this.setting.command, argv, { cwd: this.root, env: sanitiseEnv(this.o.env) as NodeJS.ProcessEnv, windowsHide: true, shell: false, stdio: usesPort ? ["ignore", "ignore", "ignore"] : ["pipe", "pipe", "ignore"] })
    const startFailed = new Promise<never>((_, reject) => this.#child!.once("error", (e) => reject(new DebugError(`The debug adapter could not be started (${(e as NodeJS.ErrnoException).code ?? e.message}).`))))
    startFailed.catch(() => undefined)
    this.#child.on("exit", () => this.#ended("the adapter exited"))
    const framer = new Framer((m) => this.#onMessage(m as Record<string, unknown>))
    const feed = (b: Buffer) => {
      try {
        framer.push(b)
      } catch {
        this.stop()
      }
    }
    if (usesPort) {
      const sock = await Promise.race([connectWithRetry(port, Date.now() + this.o.timeoutMs), startFailed])
      sock.on("data", feed)
      sock.on("error", () => undefined)
      this.#write = (s) => sock.write(s)
      this.#child.once("exit", () => sock.destroy())
    } else {
      this.#child.stdout!.on("data", feed)
      this.#child.stdin!.on("error", () => undefined)
      this.#write = (s) => this.#child!.stdin!.write(s)
    }
    await Promise.race([
      this.#request("initialize", { clientID: "codehouse", clientName: "Codehouse", adapterID: this.setting.kind, linesStartAt1: true, columnsStartAt1: true, pathFormat: "path", supportsVariableType: true }),
      startFailed,
    ])
    // The launch is answered only after configurationDone with some adapters, so it is sent first and awaited last.
    const initialized = this.#event("initialized")
    const launched = this.#request("launch", launchArgs(this.setting.kind, this.program, args, this.root))
    launched.catch(() => undefined)
    await Promise.race([initialized, launched])
    for (const [file, lines] of Object.entries(breakpoints)) await this.setBreakpoints(file, lines)
    await this.#request("configurationDone", {}).catch(() => undefined)
    await launched
    if (this.state.state === "starting") this.#set({ state: "running" })
  }

  /** Breakpoints for a file (from the folder), replacing its earlier ones; those the adapter could not place are left out. */
  async setBreakpoints(file: string, lines: number[]): Promise<number[]> {
    const abs = path.resolve(this.root, file)
    const body = (await this.#request("setBreakpoints", { source: { path: abs }, breakpoints: lines.map((line) => ({ line })), lines })) as { breakpoints?: Array<{ verified?: boolean; line?: number }> }
    const placed = (body.breakpoints ?? []).map((b, i) => (b.verified === false ? undefined : (b.line ?? lines[i]))).filter((n): n is number => typeof n === "number")
    const rel = path.relative(this.root, abs).split(path.sep).join("/")
    this.state.breakpoints = { ...this.state.breakpoints, [rel]: lines }
    if (!lines.length) delete this.state.breakpoints[rel]
    this.#set({})
    return placed
  }

  async step(kind: StepKind): Promise<void> {
    if (this.state.state === "ended") throw new DebugError("The program has ended.")
    if (kind === "pause") {
      await this.#request("pause", { threadId: this.#threadId ?? 1 })
      return
    }
    if (this.state.state !== "stopped" || this.#threadId === undefined) throw new DebugError("The program is not stopped.")
    this.#set({ state: "running", reason: undefined, frames: undefined, variables: undefined })
    await this.#request(kind, { threadId: this.#threadId })
  }

  /** Waits until the program stops or ends (or the wait runs out), and gives the state then. */
  async settle(ms: number): Promise<DebugState> {
    if (this.state.state === "stopped" || this.state.state === "ended") return this.state
    await Promise.race([this.#event("stopped-shown"), this.#event("ended"), new Promise((r) => setTimeout(r, ms))])
    return this.state
  }

  stop(): void {
    // The adapter and what it started (debugpy's launcher, the program itself): the whole tree on Windows.
    const kill = () => {
      const pid = this.#child?.pid
      try {
        if (process.platform === "win32" && pid && this.#child?.exitCode === null) spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        else this.#child?.kill()
      } catch {
        /* gone */
      }
    }
    // Disconnect even after the program ended, so the adapter lets its own helpers go (debugpy's launcher waits for it).
    try {
      this.#send({ seq: this.#seq++, type: "request", command: "disconnect", arguments: { terminateDebuggee: true } })
    } catch {
      /* gone */
    }
    // A moment for the adapter to end the program itself, then it goes whatever it is doing.
    setTimeout(kill, 500)
    this.#ended("stopped")
  }

  #set(p: Partial<DebugState>): void {
    Object.assign(this.state, p)
    for (const k of Object.keys(p) as Array<keyof DebugState>) if (p[k] === undefined) delete this.state[k]
    this.onChange(this.state)
  }

  #ended(why: string): void {
    if (this.state.state === "ended") return
    for (const [seq, p] of this.#pending) {
      clearTimeout(p.timer)
      p.reject(new DebugError(`The debugger stopped (${why}).`))
      this.#pending.delete(seq)
    }
    this.#set({ state: "ended", reason: why, frames: undefined, variables: undefined })
    this.#fire("ended", {})
  }

  #send(m: Record<string, unknown>): void {
    this.#write(frame(m))
  }

  #request(command: string, args: unknown): Promise<unknown> {
    if (this.state.state === "ended") return Promise.reject(new DebugError("The debugger has stopped."))
    const seq = this.#seq++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(seq)
        reject(new DebugError(`The debug adapter did not answer in time (${command}).`))
      }, this.o.timeoutMs)
      this.#pending.set(seq, { resolve, reject, timer })
      this.#send({ seq, type: "request", command, arguments: args })
    })
  }

  #event(event: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => this.#waiters.push({ event, resolve }))
  }

  #fire(event: string, body: Record<string, unknown>): void {
    for (let i = this.#waiters.length - 1; i >= 0; i--)
      if (this.#waiters[i]!.event === event) {
        this.#waiters[i]!.resolve(body)
        this.#waiters.splice(i, 1)
      }
  }

  #onMessage(m: Record<string, unknown>): void {
    if (m.type === "response") {
      const p = this.#pending.get(m.request_seq as number)
      if (!p) return
      clearTimeout(p.timer)
      this.#pending.delete(m.request_seq as number)
      if (m.success === false) p.reject(new DebugError(`The debug adapter said: ${String(m.message ?? "it failed").slice(0, 300)}`))
      else p.resolve(m.body ?? {})
      return
    }
    if (m.type === "request") {
      // A reverse request (runInTerminal, startDebugging): refused, so nothing runs that was not launched here.
      this.#send({ seq: this.#seq++, type: "response", request_seq: m.seq, command: m.command, success: false, message: "Codehouse does not run that." })
      return
    }
    if (m.type !== "event") return
    const body = (m.body ?? {}) as Record<string, unknown>
    this.#fire(String(m.event), body)
    if (m.event === "stopped") void this.#stopped(body)
    else if (m.event === "continued") this.#set({ state: "running", reason: undefined, frames: undefined, variables: undefined })
    else if (m.event === "terminated" || m.event === "exited") this.#ended(m.event === "exited" ? `the program exited with ${String(body.exitCode ?? "?")}` : "the program ended")
    else if (m.event === "output" && typeof body.output === "string" && body.category !== "telemetry")
      this.state.output = (this.state.output + this.#redact(body.output)).slice(-8000)
  }

  /** At a stop: the stack, and the top frame's variables (the first scope's, up to 50), redacted. */
  async #stopped(body: Record<string, unknown>): Promise<void> {
    this.#threadId = typeof body.threadId === "number" ? body.threadId : (this.#threadId ?? 1)
    try {
      const st = (await this.#request("stackTrace", { threadId: this.#threadId, startFrame: 0, levels: 20 })) as { stackFrames?: Array<{ id: number; name: string; line: number; source?: { path?: string } }> }
      const frames = st.stackFrames ?? []
      this.#frameIds = frames.map((f) => f.id)
      const shown: Frame[] = frames.map((f) => {
        const p = f.source?.path
        const inside = p && !path.relative(this.root, p).startsWith("..") && !path.isAbsolute(path.relative(this.root, p))
        return { name: this.#redact(f.name), line: f.line, ...(inside ? { file: path.relative(this.root, p).split(path.sep).join("/") } : {}) }
      })
      let variables: Variable[] = []
      if (this.#frameIds[0] !== undefined) {
        const sc = (await this.#request("scopes", { frameId: this.#frameIds[0] })) as { scopes?: Array<{ variablesReference: number; expensive?: boolean }> }
        const first = sc.scopes?.find((s) => !s.expensive && s.variablesReference > 0)
        if (first) {
          const vs = (await this.#request("variables", { variablesReference: first.variablesReference })) as { variables?: Array<{ name: string; value: string; type?: string }> }
          variables = (vs.variables ?? [])
            .filter((v) => !/^(special|function) variables$/i.test(v.name))
            .slice(0, 50)
            .map((v) => ({ name: v.name, value: this.#redact(String(v.value)).slice(0, 500), ...(v.type ? { type: v.type } : {}) }))
        }
      }
      this.#set({ state: "stopped", reason: String(body.reason ?? "stopped"), frames: shown, variables })
    } catch {
      this.#set({ state: "stopped", reason: String(body.reason ?? "stopped"), frames: [], variables: [] })
    }
    this.#fire("stopped-shown", {})
  }
}

/** A debug state as plain text, for Claude. */
export function stateText(s: DebugState | undefined): string {
  if (!s) return "Nothing is being debugged."
  const lines = [`${s.program} under ${s.adapter}: ${s.state}${s.reason ? ` (${s.reason})` : ""}.`]
  if (s.frames?.length) lines.push("Stack:", ...s.frames.slice(0, 10).map((f) => `  ${f.name} ${f.file ? `${f.file}:${f.line}` : `(outside the folder) line ${f.line}`}`))
  if (s.variables?.length) lines.push("Variables in the top frame:", ...s.variables.map((v) => `  ${v.name} = ${v.value}${v.type ? ` (${v.type})` : ""}`))
  const bps = Object.entries(s.breakpoints)
  if (bps.length) lines.push(`Breakpoints: ${bps.map(([f, l]) => `${f} ${l.join(", ")}`).join("; ")}`)
  if (s.output.trim()) lines.push("Output (the end):", s.output.trim().slice(-1500))
  return lines.join("\n")
}

/** The Companion's debug tools for one session: each acts as Claude's, and waits up to 30 seconds for a stop. */
export function debugClient(d: Debugger, sessionId: string, cwd: () => string) {
  const text = async (f: () => Promise<unknown>, wait: boolean) => {
    try {
      await f()
      const st = wait ? await d.settle(sessionId, 30_000) : d.state(sessionId)
      return { text: stateText(st) }
    } catch (e) {
      return { text: (e as Error).message, isError: true }
    }
  }
  return {
    start: (o: { adapter: string; program: string; args?: string[]; breakpoints?: Record<string, number[]> }) => text(() => d.start(sessionId, cwd(), "companion", o), true),
    breakpoints: async (file: string, lines: number[]) => {
      try {
        const placed = await d.setBreakpoints(sessionId, "companion", file, lines)
        return { text: lines.length ? `Placed at ${placed.length ? placed.join(", ") : "none of those lines"} in ${file}.` : `Cleared the breakpoints in ${file}.` }
      } catch (e) {
        return { text: (e as Error).message, isError: true }
      }
    },
    step: (kind: StepKind) => text(() => d.step(sessionId, "companion", kind), kind !== "pause"),
    state: () => text(async () => undefined, false),
    stop: () => text(() => d.stop(sessionId, "companion"), false),
  }
}

export interface DebugDeps {
  adapters: () => readonly DebugAdapterSetting[] | undefined
  audit: HostAudit
  killed: () => boolean
  policyHash: () => string
  redact: (s: string) => string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

/** One debug session per Codehouse session, each action audited with who took it. */
export class Debugger {
  readonly #d: DebugDeps
  readonly #sessions = new Map<string, DebugSession>()
  onChange: (sessionId: string, s: DebugState) => void = () => undefined

  constructor(d: DebugDeps) {
    this.#d = d
  }

  async #audit(sessionId: string, who: Who, action: string, input: Record<string, unknown>): Promise<void> {
    const ok = await this.#d.audit.record({
      session: sessionId,
      event: "debug_action",
      channel: who === "desktop" ? "desktop" : "host",
      tool: who === "desktop" ? "debugger" : "companion-debugger",
      input: { action, by: who === "desktop" ? "you" : "Claude", ...input },
      verdict: {
        outcome: "allow",
        ruleId: "debugger",
        reason: who === "desktop" ? "You used the debugger." : "Claude used the debugger through the Companion; its tool call was decided as usual.",
        risk: 0,
        decidedBy: "rules",
        policyHash: this.#d.policyHash(),
      },
      latencyMs: 0,
    })
    if (!ok) throw new DebugError("The debugger action could not be recorded in the audit log, so it was not taken.")
  }

  state(sessionId: string): DebugState | undefined {
    return this.#sessions.get(sessionId)?.state
  }

  async start(sessionId: string, root: string, who: Who, o: { adapter: string; program: string; args?: string[]; breakpoints?: Record<string, number[]> }): Promise<DebugState> {
    if (this.#d.killed()) throw new DebugError("The kill switch is engaged. Re-arm it before debugging.")
    const setting = this.#d.adapters()?.find((a) => a.name === o.adapter && a.command.trim())
    if (!setting) throw new DebugError("No debug adapter has that name. Name one in Settings, Connectors, Debug adapters.")
    const program = path.resolve(root, o.program)
    const rel = path.relative(root, program)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new DebugError("The program must be in the session's folder.")
    const breakpoints: Record<string, number[]> = {}
    for (const [f, lines] of Object.entries(o.breakpoints ?? {})) {
      const r = path.relative(root, path.resolve(root, f))
      if (!r || r.startsWith("..") || path.isAbsolute(r)) throw new DebugError(`${f} is not in the session's folder.`)
      breakpoints[f] = lines.filter((n) => Number.isInteger(n) && n > 0).slice(0, 100)
    }
    const args = (o.args ?? []).slice(0, 50).map((a) => String(a).slice(0, 1000))
    await this.#audit(sessionId, who, "start", { adapter: setting.name, program: rel.split(path.sep).join("/"), args, breakpoints })
    this.#sessions.get(sessionId)?.stop()
    const s = new DebugSession(setting, root, program, { timeoutMs: this.#d.timeoutMs ?? 20_000, env: this.#d.env ?? process.env, redact: this.#d.redact })
    s.onChange = (st) => this.onChange(sessionId, st)
    this.#sessions.set(sessionId, s)
    try {
      await s.start(args, breakpoints)
    } catch (e) {
      s.stop()
      throw e instanceof DebugError ? e : new DebugError((e as Error).message)
    }
    return s.state
  }

  #session(sessionId: string): DebugSession {
    const s = this.#sessions.get(sessionId)
    if (!s) throw new DebugError("Nothing is being debugged in this session.")
    return s
  }

  async setBreakpoints(sessionId: string, who: Who, file: string, lines: number[]): Promise<number[]> {
    const s = this.#session(sessionId)
    const r = path.relative(s.root, path.resolve(s.root, file))
    if (!r || r.startsWith("..") || path.isAbsolute(r)) throw new DebugError(`${file} is not in the session's folder.`)
    const clean = lines.filter((n) => Number.isInteger(n) && n > 0).slice(0, 100)
    await this.#audit(sessionId, who, "breakpoints", { file: r.split(path.sep).join("/"), lines: clean })
    return s.setBreakpoints(file, clean)
  }

  async step(sessionId: string, who: Who, kind: StepKind): Promise<DebugState> {
    const s = this.#session(sessionId)
    await this.#audit(sessionId, who, kind, {})
    await s.step(kind)
    return s.state
  }

  /** Waits for the program to stop or end, for the Companion's tools. */
  settle(sessionId: string, ms: number): Promise<DebugState> {
    return this.#session(sessionId).settle(ms)
  }

  async stop(sessionId: string, who: Who): Promise<void> {
    const s = this.#sessions.get(sessionId)
    if (!s) return
    await this.#audit(sessionId, who, "stop", {})
    s.stop()
    this.#sessions.delete(sessionId)
  }

  /** A closed session's program is stopped. */
  release(sessionId: string): void {
    this.#sessions.get(sessionId)?.stop()
    this.#sessions.delete(sessionId)
  }

  close(): void {
    for (const s of this.#sessions.values()) s.stop()
    this.#sessions.clear()
  }
}
