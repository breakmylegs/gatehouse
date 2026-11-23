/**
 * E-038, local log capture and viewer (Expansion E4). What Codehouse's own commands print (section 6 actions) and the
 * log files a project lists in `.codehouse/logs.yml` are read into one store per project in the data folder, a line at
 * a time: JSON lines into their fields, logfmt and the common "time level message" forms into time, level and message.
 * Every line is redacted before it is kept (invariant 12). A listed file is read only when the rules allow reading it
 * by themselves (the floor's denials, secrets files and anything held, refused here). Entries older than the retention
 * setting are dropped. The viewer searches by words, level and time.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { parseYaml } from "@gatehouse/policy"

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"

export interface LogEntry {
  /** ISO time, the line's own when it has one, else when it was read. */
  at: string
  level?: LogLevel
  message: string
  fields?: Record<string, string>
  /** Where it came from: "action: <command>" or the file's path. */
  source: string
}

const LEVELS: Record<string, LogLevel> = {
  trace: "trace", verbose: "trace", debug: "debug", dbg: "debug", info: "info", information: "info", notice: "info", inf: "info",
  warn: "warn", warning: "warn", wrn: "warn", error: "error", err: "error", erro: "error", fatal: "fatal", critical: "fatal", crit: "fatal", panic: "fatal",
}
/** pino and bunyan write levels as numbers. */
const NUMERIC: Record<number, LogLevel> = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" }

const levelOf = (v: unknown): LogLevel | undefined => (typeof v === "number" ? NUMERIC[v] : typeof v === "string" ? LEVELS[v.toLowerCase()] : undefined)
const timeOf = (v: unknown): string | undefined => {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString()
  if (typeof v !== "string") return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}
const flat = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v))

/** One line read into its parts; redaction is applied by the store. */
export function parseLine(line: string, source: string, now = new Date()): LogEntry | undefined {
  const text = line.replace(/\r$/, "")
  if (!text.trim()) return undefined
  const fallback = now.toISOString()
  if (/^\s*\{/.test(text))
    try {
      const j = JSON.parse(text) as Record<string, unknown>
      const message = j.msg ?? j.message ?? j.Message ?? j["@m"] ?? j["@mt"] ?? ""
      const level = levelOf(j.level ?? j.lvl ?? j.severity ?? j.Level ?? j["@l"] ?? j.levelname)
      const at = timeOf(j.time ?? j.timestamp ?? j.ts ?? j["@timestamp"] ?? j["@t"] ?? j.Timestamp ?? j.date)
      const skip = new Set(["msg", "message", "Message", "@m", "@mt", "level", "lvl", "severity", "Level", "@l", "levelname", "time", "timestamp", "ts", "@timestamp", "@t", "Timestamp", "date"])
      const fields = Object.fromEntries(Object.entries(j).filter(([k]) => !skip.has(k)).slice(0, 50).map(([k, v]) => [k, flat(v).slice(0, 2000)]))
      return { at: at ?? fallback, ...(level ? { level } : {}), message: flat(message).slice(0, 4000), ...(Object.keys(fields).length ? { fields } : {}), source }
    } catch {
      // Not JSON after all: read as text below.
    }
  // logfmt: key=value pairs, with level= and msg=.
  if (/^(\w[\w.-]*=("[^"]*"|\S*)\s*){2,}$/.test(text.trim())) {
    const pairs = Object.fromEntries([...text.matchAll(/(\w[\w.-]*)=("((?:[^"\\]|\\.)*)"|\S*)/g)].map((m) => [m[1]!, m[3] ?? m[2]!]))
    const { level, lvl, msg, message, time, ts, ...rest } = pairs
    const lv = levelOf(level ?? lvl)
    return { at: timeOf(time ?? ts) ?? fallback, ...(lv ? { level: lv } : {}), message: (msg ?? message ?? "").slice(0, 4000), ...(Object.keys(rest).length ? { fields: rest } : {}), source }
  }
  // "2026-11-23T01:02:03Z INFO message", "[2026-11-23 01:02:03] [error] message", "INFO 2026-... message".
  const m = /^\[?(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?)\]?\s+\[?([A-Za-z]+)\]?:?\s+(.*)$/.exec(text) ?? /^\[?([A-Za-z]+)\]?:?\s+\[?(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?)\]?\s+(.*)$/.exec(text)
  if (m) {
    const [a, b] = /^\d/.test(m[1]!) ? [m[1]!, m[2]!] : [m[2]!, m[1]!]
    const lv = levelOf(b)
    if (lv) return { at: timeOf(a.replace(",", ".")) ?? fallback, level: lv, message: m[3]!.slice(0, 4000), source }
  }
  const bare = /^\s*(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\b[:\s]+(.*)$/i.exec(text)
  if (bare) return { at: fallback, level: levelOf(bare[1])!, message: bare[2]!.slice(0, 4000), source }
  return { at: fallback, message: text.slice(0, 4000), source }
}

/** The log files a project lists, from .codehouse/logs.yml: `files: [path, ...]`. */
export function listedLogs(root: string): string[] {
  try {
    const v = parseYaml(fs.readFileSync(path.join(root, ".codehouse", "logs.yml"), "utf8")) as { files?: unknown }
    return Array.isArray(v?.files) ? (v.files as unknown[]).filter((f): f is string => typeof f === "string").slice(0, 50) : []
  } catch {
    return []
  }
}

export interface LogQuery {
  text?: string
  level?: LogLevel
  since?: string
  until?: string
  limit?: number
}

const ORDER: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"]

export class LogStore {
  readonly #offsets = new Map<string, number>()

  constructor(
    readonly dir: string,
    private readonly redact: (s: string) => string,
    private readonly retentionDays: (project: string) => number = () => 7,
    /** E-066: a legal hold on the project keeps its lines past their retention. */
    private readonly held: (project: string) => boolean = () => false,
  ) {}

  #file(project: string) {
    return path.join(this.dir, `${crypto.createHash("sha256").update(project.toLowerCase()).digest("hex").slice(0, 16)}.jsonl`)
  }

  /** Keeps lines, each parsed and redacted, and drops what is past the retention. */
  append(project: string, source: string, text: string): number {
    const now = new Date()
    const entries = text
      .split("\n")
      .slice(-5000)
      .map((l) => parseLine(l, source, now))
      .filter((e): e is LogEntry => !!e)
      .map((e) => ({
        ...e,
        message: this.redact(e.message),
        source: this.redact(e.source),
        ...(e.fields ? { fields: Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, this.redact(v)])) } : {}),
      }))
    if (!entries.length) return 0
    fs.mkdirSync(this.dir, { recursive: true })
    fs.appendFileSync(this.#file(project), entries.map((e) => JSON.stringify(e)).join("\n") + "\n")
    this.prune(project)
    return entries.length
  }

  /** Drops entries older than the retention, rewriting the file atomically. */
  prune(project: string): void {
    const file = this.#file(project)
    let lines: string[]
    try {
      lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    } catch {
      return
    }
    if (this.held(project)) return
    const cut = Date.now() - this.retentionDays(project) * 86_400_000
    const kept = lines.filter((l) => {
      try {
        return Date.parse((JSON.parse(l) as LogEntry).at) >= cut
      } catch {
        return false
      }
    })
    if (kept.length === lines.length && kept.length <= 200_000) return
    fs.writeFileSync(`${file}.tmp`, kept.slice(-200_000).join("\n") + (kept.length ? "\n" : ""))
    fs.renameSync(`${file}.tmp`, file)
  }

  query(project: string, q: LogQuery = {}): LogEntry[] {
    let lines: string[]
    try {
      lines = fs.readFileSync(this.#file(project), "utf8").split("\n").filter(Boolean)
    } catch {
      return []
    }
    const words = (q.text ?? "").toLowerCase().split(/\s+/).filter(Boolean)
    const min = q.level ? ORDER.indexOf(q.level) : -1
    const out: LogEntry[] = []
    for (let i = lines.length - 1; i >= 0 && out.length < (q.limit ?? 500); i--) {
      let e: LogEntry
      try {
        e = JSON.parse(lines[i]!) as LogEntry
      } catch {
        continue
      }
      if (min >= 0 && (!e.level || ORDER.indexOf(e.level) < min)) continue
      if (q.since && e.at < q.since) continue
      if (q.until && e.at > q.until) continue
      if (words.length) {
        const hay = `${e.message} ${e.source} ${Object.entries(e.fields ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")}`.toLowerCase()
        if (!words.every((w) => hay.includes(w))) continue
      }
      out.push(e)
    }
    return out
  }

  /**
   * Reads what each listed file has gained since it was last read (its first read takes its last 256 KB), when the
   * rules allow reading it by themselves; says which were refused.
   */
  async tail(project: string, root: string, allowedToRead: (abs: string) => Promise<boolean>): Promise<{ read: string[]; refused: string[] }> {
    const read: string[] = []
    const refused: string[] = []
    for (const rel of listedLogs(root)) {
      const abs = path.resolve(root, rel)
      if (!(await allowedToRead(abs).catch(() => false))) {
        refused.push(rel)
        continue
      }
      let fd: number | undefined
      try {
        const size = fs.statSync(abs).size
        const key = abs.toLowerCase()
        const from = Math.min(size, this.#offsets.get(key) ?? Math.max(0, size - 256 * 1024))
        const start = from > size ? 0 : from
        fd = fs.openSync(abs, "r")
        const buf = Buffer.alloc(Math.min(size - start, 4 * 1024 * 1024))
        fs.readSync(fd, buf, 0, buf.length, start)
        this.#offsets.set(key, start + buf.length)
        const text = buf.toString("utf8")
        // A first read can start mid-line: that partial line is dropped.
        this.append(project, rel, start > 0 && !this.#offsets.has(`${key}:seen`) ? text.slice(text.indexOf("\n") + 1) : text)
        this.#offsets.set(`${key}:seen`, 1)
        read.push(rel)
      } catch {
        refused.push(rel)
      } finally {
        if (fd !== undefined) fs.closeSync(fd)
      }
    }
    return { read, refused }
  }
}
