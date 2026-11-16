/**
 * O39: runs the MCP servers you built. Each is a Node process in its own folder, inside a job object with its processor
 * and memory caps when Codehouse-Limits can make one (limits.ts), with the environment Claude's sessions get (no
 * credentials, invariant 6). Codehouse talks to it as an MCP client over stdio; sessions reach it only through the
 * in-process bridge (bridge.ts), because this computer's policy loads no stdio server in a session (docs/sdk-notes.md).
 */
import { createRequire } from "node:module"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { sanitiseEnv } from "@gatehouse/shared"
import type { BuiltServer, BuiltServers } from "./store.js"

export type RunState = "stopped" | "starting" | "running" | "failed"

export interface RunStatus {
  name: string
  state: RunState
  /** Why it failed, or the last thing it wrote to stderr. Never shown to Claude. */
  error?: string
  tools: Array<{ name: string; description?: string }>
  /** Whether its caps are applied (false where no job object can be made). */
  limited: boolean
  startedAt?: string
}

/** Where Codehouse's own packages are, for NODE_PATH, so a server can require the MCP SDK and zod. */
export function packagesDir(): string {
  const req = createRequire(import.meta.url)
  // The package's exports map its files deep inside it, so walk up to the node_modules folder that holds it.
  let d = path.dirname(req.resolve("@modelcontextprotocol/sdk/server/mcp.js"))
  while (path.basename(d) !== "node_modules" && path.dirname(d) !== d) d = path.dirname(d)
  return d
}

/** The command that runs a server: Node on its entry, inside Codehouse-Limits with its caps when there is one. */
export function commandFor(s: BuiltServer, folder: string, limitsExe: string | undefined, node = process.execPath): { command: string; args: string[]; limited: boolean } {
  const entry = path.join(folder, s.entry)
  if (!limitsExe) return { command: node, args: [entry], limited: false }
  return {
    command: limitsExe,
    args: ["--name", `codeh-mcp-${s.name}`, "--cpu", String(s.cpu), "--memory-mb", String(s.memoryMb), "--priority", "below", "--", node, entry],
    limited: true,
  }
}

interface Running {
  client: Client
  transport: StdioClientTransport
  tools: Tool[]
  startedAt: string
  limited: boolean
}

export interface RunnerDeps {
  store: BuiltServers
  limitsExe?: () => string | undefined
  env?: NodeJS.ProcessEnv
  log: (line: string) => void
  /** Called whenever a server's state changes, so the window and sessions can follow. */
  onChange?: (s: RunStatus) => void
  /** How long a server may take to start and list its tools. */
  startTimeoutMs?: number
}

export class McpRunner {
  readonly #d: RunnerDeps
  readonly #running = new Map<string, Running>()
  readonly #state = new Map<string, { state: RunState; error?: string }>()

  constructor(d: RunnerDeps) {
    this.#d = d
  }

  status(name: string): RunStatus {
    const r = this.#running.get(name)
    const st = this.#state.get(name) ?? { state: "stopped" as const }
    return {
      name,
      state: st.state,
      ...(st.error ? { error: st.error } : {}),
      tools: (r?.tools ?? []).map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}) })),
      limited: r?.limited ?? false,
      ...(r ? { startedAt: r.startedAt } : {}),
    }
  }

  all(): RunStatus[] {
    return this.#d.store.list().map((s) => this.status(s.name))
  }

  /** The client of a running server, for the bridge. */
  client(name: string): { client: Client; tools: Tool[] } | undefined {
    const r = this.#running.get(name)
    return r ? { client: r.client, tools: r.tools } : undefined
  }

  #set(name: string, state: RunState, error?: string): void {
    this.#state.set(name, { state, ...(error ? { error } : {}) })
    this.#d.onChange?.(this.status(name))
  }

  async start(name: string): Promise<RunStatus> {
    const s = this.#d.store.get(name)
    if (!s) throw new Error(`There is no server called ${name}.`)
    if (this.#running.has(name)) return this.status(name)
    this.#set(name, "starting")
    const folder = this.#d.store.folder(name)
    const cmd = commandFor(s, folder, this.#d.limitsExe?.())
    const env = sanitiseEnv(this.#d.env ?? process.env)
    const nodePath = [packagesDir(), env.NODE_PATH].filter(Boolean).join(path.delimiter)
    const transport = new StdioClientTransport({
      command: cmd.command,
      args: cmd.args,
      cwd: folder,
      env: { ...(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>), NODE_PATH: nodePath },
      stderr: "pipe",
    })
    let lastErr = ""
    transport.stderr?.on("data", (d: Buffer) => {
      lastErr = (lastErr + d.toString("utf8")).slice(-2000)
    })
    const client = new Client({ name: "codehouse", version: "1" })
    const timeout = this.#d.startTimeoutMs ?? 20_000
    try {
      await withTimeout(client.connect(transport), timeout, "It did not answer as an MCP server in time.")
      const listed = await withTimeout(client.listTools(), timeout, "It did not list its tools in time.")
      const r: Running = { client, transport, tools: listed.tools, startedAt: new Date().toISOString(), limited: cmd.limited }
      this.#running.set(name, r)
      transport.onclose = () => {
        if (this.#running.get(name) !== r) return
        this.#running.delete(name)
        this.#set(name, "failed", lastErr.trim().split("\n").slice(-3).join("\n") || "It stopped.")
      }
      this.#set(name, "running")
      this.#d.log(`mcp builder: ${name} started with ${listed.tools.length} tools${cmd.limited ? "" : " (no caps here)"}`)
      return this.status(name)
    } catch (e) {
      await client.close().catch(() => undefined)
      const why = `${(e as Error).message}${lastErr.trim() ? `\n${lastErr.trim().split("\n").slice(-3).join("\n")}` : ""}`
      this.#set(name, "failed", why)
      return this.status(name)
    }
  }

  async stop(name: string): Promise<RunStatus> {
    const r = this.#running.get(name)
    this.#running.delete(name)
    if (r) await r.client.close().catch(() => undefined)
    this.#set(name, "stopped")
    return this.status(name)
  }

  async restart(name: string): Promise<RunStatus> {
    await this.stop(name)
    return await this.start(name)
  }

  /** Starts each server set to start with Codehouse. One that fails is recorded and the rest go on. */
  async startAutostart(): Promise<void> {
    for (const s of this.#d.store.list()) if (s.autostart) await this.start(s.name)
  }

  async stopAll(): Promise<void> {
    for (const name of [...this.#running.keys()]) await this.stop(name)
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(why)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e as Error)),
    )
  })
}
