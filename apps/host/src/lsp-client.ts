/**
 * G34 (owner's connector items, 9 Nov): language servers you have installed (pyright, gopls, rust-analyzer, clangd and
 * the like), for the file view, as C-032 gives TypeScript: a file's problems, what the name at the cursor is (as text),
 * and where it is defined or used. Off until you name a server in Settings, Connectors, Language servers: its command,
 * and the file endings it is for. Codehouse starts it in the session's folder, without a shell and with no credential
 * in its environment, talks to it over stdin and stdout (the Language Server Protocol), stops it after ten idle minutes
 * or when it does not answer in time, and passes on only places inside the session's folder. A server only reads:
 * nothing it says is applied to a file.
 */
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { sanitiseEnv } from "@gatehouse/shared"

export interface LanguageServerSetting {
  name: string
  command: string
  args?: string[]
  /** File endings it is for, with or without the dot: py, .pyi. */
  extensions: string[]
}

export type LspOp = "diagnostics" | "info" | "definition" | "references"

export interface Place {
  file: string
  line: number
  column: number
  text: string
}
export interface Problem extends Place {
  message: string
  severity: "error" | "warning" | "info"
}

export class LspError extends Error {}

const ext = (e: string) => (e.startsWith(".") ? e : `.${e}`).toLowerCase()

/** The server named for a file, by its ending. */
export function serverFor(list: readonly LanguageServerSetting[] | undefined, file: string): LanguageServerSetting | undefined {
  const e = path.extname(file).toLowerCase()
  return e ? list?.find((s) => s.command.trim() && s.extensions.some((x) => ext(x) === e)) : undefined
}

/** An offset in a text as the protocol's line and character (both from 0, characters in UTF-16 units). */
export function positionAt(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = before.split("\n")
  return { line: lines.length - 1, character: lines.at(-1)!.length }
}

/** Reads framed messages (Content-Length: n, a blank line, then n bytes of JSON) from a stream of chunks. */
export class Framer {
  #buf = Buffer.alloc(0)
  constructor(private readonly onMessage: (m: unknown) => void, private readonly maxBytes = 32 * 1024 * 1024) {}
  push(chunk: Buffer): void {
    this.#buf = Buffer.concat([this.#buf, chunk])
    for (;;) {
      const end = this.#buf.indexOf("\r\n\r\n")
      if (end < 0) {
        if (this.#buf.length > 64 * 1024) throw new LspError("The language server sent a header that never ended.")
        return
      }
      const head = this.#buf.subarray(0, end).toString("ascii")
      const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? NaN)
      if (!Number.isFinite(len) || len > this.maxBytes) throw new LspError("The language server sent a message too large or without its length.")
      if (this.#buf.length < end + 4 + len) return
      const body = this.#buf.subarray(end + 4, end + 4 + len).toString("utf8")
      this.#buf = this.#buf.subarray(end + 4 + len)
      try {
        this.onMessage(JSON.parse(body))
      } catch {
        throw new LspError("The language server sent something that is not JSON.")
      }
    }
  }
}

export const frame = (m: unknown): string => {
  const body = JSON.stringify(m)
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/** One running server for one folder. */
class Connection {
  readonly child: ChildProcess
  #next = 1
  readonly #pending = new Map<number, Pending>()
  readonly #diagnostics = new Map<string, unknown[]>()
  readonly #waiters = new Map<string, Array<() => void>>()
  readonly #versions = new Map<string, number>()
  ready: Promise<void>
  lastUsed = Date.now()
  dead: string | undefined

  constructor(
    readonly root: string,
    setting: LanguageServerSetting,
    private readonly timeoutMs: number,
    env: NodeJS.ProcessEnv,
    onEnd: (why: string) => void,
  ) {
    this.child = spawn(setting.command, setting.args ?? [], { cwd: root, env: sanitiseEnv(env) as NodeJS.ProcessEnv, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "ignore"] })
    const framer = new Framer((m) => this.#onMessage(m as Record<string, unknown>))
    this.child.stdout!.on("data", (b: Buffer) => {
      try {
        framer.push(b)
      } catch (e) {
        this.end((e as Error).message)
      }
    })
    this.child.on("error", (e) => this.end(`it could not be started (${(e as NodeJS.ErrnoException).code ?? e.message})`))
    this.child.on("exit", (code) => this.end(`it exited with ${code}`))
    this.child.stdin!.on("error", () => undefined)
    const ended = onEnd
    this.#onEnd = ended
    this.ready = this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
      capabilities: {
        textDocument: { hover: { contentFormat: ["plaintext", "markdown"] }, definition: {}, references: {}, publishDiagnostics: {}, synchronization: { didSave: false } },
        workspace: { workspaceFolders: true },
      },
    }).then(() => this.notify("initialized", {}))
  }

  readonly #onEnd: (why: string) => void

  end(why: string): void {
    if (this.dead) return
    this.dead = why
    for (const [id, p] of this.#pending) {
      clearTimeout(p.timer)
      p.reject(new LspError(`The language server stopped (${why}).`))
      this.#pending.delete(id)
    }
    try {
      this.child.kill()
    } catch {
      /* gone */
    }
    this.#onEnd(why)
  }

  #send(m: unknown): void {
    if (this.dead) throw new LspError(`The language server stopped (${this.dead}).`)
    this.child.stdin!.write(frame(m))
  }

  notify(method: string, params: unknown): void {
    this.#send({ jsonrpc: "2.0", method, params })
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.#next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new LspError(`The language server did not answer in time (${method}).`))
        // A server that does not answer is stopped; the next look starts it again.
        this.end("it did not answer in time")
      }, this.timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      try {
        this.#send({ jsonrpc: "2.0", id, method, params })
      } catch (e) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(e as Error)
      }
    })
  }

  #onMessage(m: Record<string, unknown>): void {
    if (typeof m.id === "number" && ("result" in m || "error" in m) && !("method" in m)) {
      const p = this.#pending.get(m.id)
      if (!p) return
      clearTimeout(p.timer)
      this.#pending.delete(m.id)
      const err = m.error as { message?: string } | undefined
      if (err) p.reject(new LspError(`The language server said: ${String(err.message ?? "an error").slice(0, 300)}`))
      else p.resolve(m.result)
      return
    }
    if (m.method === "textDocument/publishDiagnostics") {
      const params = m.params as { uri?: string; diagnostics?: unknown[] }
      if (typeof params?.uri !== "string") return
      this.#diagnostics.set(params.uri, Array.isArray(params.diagnostics) ? params.diagnostics : [])
      for (const w of this.#waiters.get(params.uri) ?? []) w()
      this.#waiters.delete(params.uri)
      return
    }
    // A request from the server (configuration, a progress token): answered with nothing, so it carries on.
    if (typeof m.id === "number" || typeof m.id === "string") {
      try {
        this.#send({ jsonrpc: "2.0", id: m.id, result: m.method === "workspace/configuration" ? [] : null })
      } catch {
        /* stopped */
      }
    }
  }

  /** Opens (or updates) a file as it is on disk, so the server reads what you see. */
  open(abs: string, text: string, languageId: string): string {
    const uri = pathToFileURL(abs).href
    const v = (this.#versions.get(uri) ?? 0) + 1
    this.#versions.set(uri, v)
    if (v === 1) this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: v, text } })
    else this.notify("textDocument/didChange", { textDocument: { uri, version: v }, contentChanges: [{ text }] })
    return uri
  }

  /** The file's problems: once the server has published them, or what it has after the wait. */
  diagnostics(uri: string, waitMs: number): Promise<unknown[]> {
    return new Promise((resolve) => {
      const done = () => resolve(this.#diagnostics.get(uri) ?? [])
      const t = setTimeout(done, waitMs)
      const list = this.#waiters.get(uri) ?? []
      list.push(() => {
        clearTimeout(t)
        done()
      })
      this.#waiters.set(uri, list)
    })
  }
}

export interface LspDeps {
  servers: () => readonly LanguageServerSetting[] | undefined
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** How long to wait for a file's problems after opening it. */
  diagnosticsWaitMs?: number
  idleMs?: number
  log?: (line: string) => void
}

const LANGUAGE_IDS: Record<string, string> = {
  ".py": "python", ".pyi": "python", ".go": "go", ".rs": "rust", ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
  ".cs": "csharp", ".java": "java", ".kt": "kotlin", ".rb": "ruby", ".php": "php", ".lua": "lua", ".swift": "swift", ".sh": "shellscript",
}

/** The servers you named, one running per server and folder, stopped when idle and with Codehouse. */
export class LanguageServers {
  readonly #d: LspDeps
  readonly #running = new Map<string, Connection>()
  readonly #idle: NodeJS.Timeout

  constructor(d: LspDeps) {
    this.#d = d
    this.#idle = setInterval(() => this.#sweep(), 60_000)
    this.#idle.unref()
  }

  #sweep(): void {
    const limit = this.#d.idleMs ?? 10 * 60_000
    for (const [k, c] of this.#running) if (Date.now() - c.lastUsed > limit) {
      c.end("it was idle")
      this.#running.delete(k)
    }
  }

  /** Whether a server is named for this file. */
  has(file: string): boolean {
    return serverFor(this.#d.servers(), file) !== undefined
  }

  #connection(root: string, s: LanguageServerSetting): Connection {
    const key = `${s.name}\u0000${s.command}\u0000${root}`
    const was = this.#running.get(key)
    if (was && !was.dead) return was
    const c = new Connection(root, s, this.#d.timeoutMs ?? 20_000, this.#d.env ?? process.env, (why) => {
      if (this.#running.get(key) === c) this.#running.delete(key)
      this.#d.log?.(`language server ${s.name}: stopped (${why})`)
    })
    this.#running.set(key, c)
    return c
  }

  /** Asks the file's server; places outside the folder are left out, and the rest are given from the folder. */
  async ask(op: LspOp, root: string, abs: string, offset: number): Promise<Problem[] | Place[] | { text: string } | null> {
    const s = serverFor(this.#d.servers(), abs)
    if (!s) throw new LspError("No language server is named for this kind of file.")
    const text = fs.readFileSync(abs, "utf8")
    const c = this.#connection(root, s)
    c.lastUsed = Date.now()
    await c.ready
    const uri = c.open(abs, text, LANGUAGE_IDS[path.extname(abs).toLowerCase()] ?? path.extname(abs).slice(1))
    const textOf = new Map<string, string[]>([[abs, text.split("\n")]])
    const inside = (file: string) => {
      const r = path.relative(root, file)
      return r !== "" && !r.startsWith("..") && !path.isAbsolute(r)
    }
    const place = (loc: { uri?: string; targetUri?: string; range?: Range; targetSelectionRange?: Range }): Place | undefined => {
      const u = loc.targetUri ?? loc.uri
      const range = loc.targetSelectionRange ?? loc.range
      if (typeof u !== "string" || !u.startsWith("file:") || !range) return undefined
      const file = fileURLToPath(u)
      if (!inside(file)) return undefined
      let lines = textOf.get(file)
      if (!lines) {
        try {
          lines = fs.readFileSync(file, "utf8").split("\n")
        } catch {
          lines = []
        }
        textOf.set(file, lines)
      }
      const line = range.start.line + 1
      return { file: path.relative(root, file).split(path.sep).join("/"), line, column: range.start.character + 1, text: (lines[line - 1] ?? "").trim().slice(0, 200) }
    }
    const position = positionAt(text, offset)
    if (op === "diagnostics") {
      const list = (await c.diagnostics(uri, this.#d.diagnosticsWaitMs ?? 3000)) as Array<{ range?: Range; message?: string; severity?: number }>
      return list.flatMap((d) => {
        const p = d.range ? place({ uri, range: d.range }) : undefined
        return p ? [{ ...p, message: String(d.message ?? "").slice(0, 500), severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info" } as Problem] : []
      })
    }
    if (op === "info") {
      const h = (await c.request("textDocument/hover", { textDocument: { uri }, position })) as { contents?: unknown } | null
      const t = hoverText(h?.contents)
      return t ? { text: t } : null
    }
    const result = await c.request(op === "definition" ? "textDocument/definition" : "textDocument/references", {
      textDocument: { uri },
      position,
      ...(op === "references" ? { context: { includeDeclaration: true } } : {}),
    })
    const locs = (Array.isArray(result) ? result : result ? [result] : []) as Array<Parameters<typeof place>[0]>
    return locs.flatMap((l) => {
      const p = place(l)
      return p ? [p] : []
    }).slice(0, 200)
  }

  close(): void {
    clearInterval(this.#idle)
    for (const c of this.#running.values()) c.end("Codehouse stopped")
    this.#running.clear()
  }
}

interface Range {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

/** A hover's contents as plain text: a string, { value }, or a list of them; code fences taken off. */
export function hoverText(c: unknown): string {
  const one = (x: unknown): string => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { value?: unknown }).value === "string" ? (x as { value: string }).value : "")
  const raw = Array.isArray(c) ? c.map(one).filter(Boolean).join("\n") : one(c)
  return raw
    .replace(/```[\w-]*\n?/g, "")
    .trim()
    .slice(0, 2000)
}
