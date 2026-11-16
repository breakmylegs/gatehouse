/**
 * O39, the MCP builder: the MCP servers you build in Codehouse, each in a folder of its own under the data folder
 * (mcp-servers/<name>), listed in mcp-servers.json with how it runs. Read tolerantly and changed only by adding, so an
 * older or newer copy keeps what it does not know (an update can be undone).
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

/** A name you can type after /mcp: lower case letters, digits and dashes, starting with a letter. */
export const SERVER_NAME = /^[a-z][a-z0-9-]{1,30}$/

export interface BuiltServer {
  name: string
  /** Started when Codehouse starts. Off unless you switch it on. */
  autostart: boolean
  /** The most of the whole processor it may use, as a percentage; 0 for no cap. */
  cpu: number
  /** The most memory its processes may use, in MB; 0 for no cap. */
  memoryMb: number
  /** The file Node runs, inside its folder. */
  entry: string
  createdAt: string
}

export const DEFAULT_LIMITS = { cpu: 20, memoryMb: 512 } as const

const ENTRY = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,120}\.(mjs|cjs|js)$/

/** One saved entry, or undefined when it cannot be one; what it does not know is kept by the caller. */
function readOne(v: unknown): BuiltServer | undefined {
  if (!v || typeof v !== "object") return undefined
  const o = v as Record<string, unknown>
  if (typeof o.name !== "string" || !SERVER_NAME.test(o.name)) return undefined
  const num = (x: unknown, max: number, d: number) => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= max ? x : d)
  const entry = typeof o.entry === "string" && ENTRY.test(o.entry) && !o.entry.split("/").includes("..") ? o.entry : "server.cjs"
  return {
    name: o.name,
    autostart: o.autostart === true,
    cpu: num(o.cpu, 100, DEFAULT_LIMITS.cpu),
    memoryMb: num(o.memoryMb, 65536, DEFAULT_LIMITS.memoryMb),
    entry,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
  }
}

/** A starter server for a new folder: one tool, so the builder session has something that runs to change. */
// CommonJS, so the MCP SDK and zod come from Codehouse's own packages through NODE_PATH (runner.ts), with nothing to
// install first; ES modules ignore NODE_PATH.
export const STARTER = `// An MCP server built in Codehouse. Codehouse runs it with Node when you start it, and sessions use it with /mcp.
// The MCP SDK and zod come with Codehouse. Write to stderr for logs: stdout carries the MCP messages.
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js")
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js")
const { z } = require("zod")

const server = new McpServer({ name: "NAME", version: "0.1.0" })

server.registerTool(
  "hello",
  { description: "Says hello to someone.", inputSchema: { name: z.string() } },
  async ({ name }) => ({ content: [{ type: "text", text: \`Hello, \${name}.\` }] }),
)

server.connect(new StdioServerTransport()).catch((e) => {
  console.error(e)
  process.exit(1)
})
`

/** What a session building the server is told, as the folder's CLAUDE.md, which Claude Code reads by itself. */
export const BUILDER_NOTES = `# The MCP server NAME

This folder is an MCP server built in Codehouse. Codehouse runs it, and sessions use it by typing /mcp NAME.

- Codehouse runs \`server.cjs\` with Node, over stdio. Keep it CommonJS (\`require\`).
- \`@modelcontextprotocol/sdk\` and \`zod\` come with Codehouse; do not install them. Add other packages with npm in
  this folder only if the server needs them.
- stdout carries the MCP messages: write logs to stderr (\`console.error\`).
- After a change, restart it in Codehouse, MCP, and try it from a session with /mcp NAME.
- It runs with the processor and memory limits set in Codehouse, MCP, and never sees your Claude credentials.
- Other servers that are running were given to this session, so you can call them while you build.
`

export class BuiltServers {
  readonly #file: string
  readonly #root: string

  constructor(dataDir: string) {
    this.#file = path.join(dataDir, "mcp-servers.json")
    this.#root = path.join(dataDir, "mcp-servers")
  }

  /** The folder a server lives in. */
  folder(name: string): string {
    if (!SERVER_NAME.test(name)) throw new Error("That is not a server name.")
    return path.join(this.#root, name)
  }

  #raw(): { servers: unknown[]; [k: string]: unknown } {
    try {
      const j = JSON.parse(fs.readFileSync(this.#file, "utf8")) as Record<string, unknown>
      return { ...j, servers: Array.isArray(j.servers) ? j.servers : [] }
    } catch {
      return { servers: [] }
    }
  }

  list(): BuiltServer[] {
    return this.#raw().servers.map(readOne).filter((s): s is BuiltServer => s !== undefined)
  }

  get(name: string): BuiltServer | undefined {
    return this.list().find((s) => s.name === name)
  }

  /** Changes one entry and keeps every field and entry it does not know. */
  async #write(name: string, change: (old: Record<string, unknown> | undefined) => Record<string, unknown> | undefined): Promise<void> {
    const raw = this.#raw()
    const i = raw.servers.findIndex((s) => (s as { name?: unknown } | null)?.name === name)
    const next = change(i >= 0 ? (raw.servers[i] as Record<string, unknown>) : undefined)
    const servers = [...raw.servers]
    if (i >= 0) {
      if (next) servers[i] = next
      else servers.splice(i, 1)
    } else if (next) servers.push(next)
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, JSON.stringify({ ...raw, servers }, null, 2))
  }

  /** A new server: its folder with the starter, and its entry with the default limits, off at start-up. */
  async create(name: string, now = new Date()): Promise<BuiltServer> {
    if (!SERVER_NAME.test(name)) throw new Error("A name of 2 to 31 lower case letters, digits and dashes, starting with a letter.")
    if (this.get(name)) throw new Error(`There is already a server called ${name}.`)
    const dir = this.folder(name)
    fs.mkdirSync(dir, { recursive: true })
    const entry = path.join(dir, "server.cjs")
    if (!fs.existsSync(entry)) await writeFileAtomic(entry, STARTER.replace("NAME", name))
    const notes = path.join(dir, "CLAUDE.md")
    if (!fs.existsSync(notes)) await writeFileAtomic(notes, BUILDER_NOTES.replaceAll("NAME", name))
    await this.#write(name, () => ({ name, autostart: false, ...DEFAULT_LIMITS, entry: "server.cjs", createdAt: now.toISOString() }))
    return this.get(name)!
  }

  /** Changes how it runs; only these fields, each checked. */
  async update(name: string, p: { autostart?: boolean; cpu?: number; memoryMb?: number }): Promise<BuiltServer> {
    if (!this.get(name)) throw new Error(`There is no server called ${name}.`)
    const int = (v: number | undefined, max: number) => (v === undefined ? undefined : Number.isInteger(v) && v >= 0 && v <= max ? v : NaN)
    const cpu = int(p.cpu, 100)
    const memoryMb = int(p.memoryMb, 65536)
    if (Number.isNaN(cpu) || Number.isNaN(memoryMb)) throw new Error("The processor share is 0 to 100 and the memory 0 to 65536 MB (0 for no cap).")
    if (memoryMb !== undefined && memoryMb > 0 && memoryMb < 64) throw new Error("Give it at least 64 MB, or 0 for no cap.")
    await this.#write(name, (old) => ({
      ...old,
      ...(p.autostart !== undefined ? { autostart: p.autostart } : {}),
      ...(cpu !== undefined ? { cpu } : {}),
      ...(memoryMb !== undefined ? { memoryMb } : {}),
    }))
    return this.get(name)!
  }

  /** Takes it off the list. Its folder is kept, so nothing you built is lost by a slip. */
  async remove(name: string): Promise<void> {
    await this.#write(name, () => undefined)
  }
}
