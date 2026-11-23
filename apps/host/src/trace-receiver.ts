/**
 * E-040, a local trace receiver (Expansion E4). An OTLP/HTTP receiver for traces in JSON (`POST /v1/traces`), on
 * 127.0.0.1 only and off unless switched on in Settings. Following section 10 and invariant 7, a request is taken only
 * when it carries a project's own token (`Authorization: Bearer <token>`, which OTLP exporters send through
 * OTEL_EXPORTER_OTLP_HEADERS), its Host is this computer at the receiver's port, it has no Origin (so no web page can
 * post to it), and its body is at most 4 MB and JSON. Tokens are kept only as hashes; a token is shown once, when it is
 * made. Every attribute is redacted before a span is kept (invariant 12). Spans are kept per project, the most recent
 * 20,000, and shown as a tree for each trace.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"

export const MAX_BODY = 4 * 1024 * 1024

export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  service?: string
  start: number
  end: number
  status?: "ok" | "error"
  attributes: Record<string, string>
}

export interface SpanNode extends Span {
  children: SpanNode[]
}

const hex = (v: unknown) => (typeof v === "string" ? (/^[0-9a-f]+$/i.test(v) ? v.toLowerCase() : Buffer.from(v, "base64").toString("hex")) : "")
const ns = (v: unknown) => Number(typeof v === "string" || typeof v === "number" ? BigInt(String(v).split(".")[0]!) / 1_000_000n : 0n)

/** An OTLP attribute's value as text. */
function value(v: unknown): string {
  const o = (v ?? {}) as Record<string, unknown>
  if ("stringValue" in o) return String(o.stringValue)
  if ("intValue" in o) return String(o.intValue)
  if ("doubleValue" in o) return String(o.doubleValue)
  if ("boolValue" in o) return String(o.boolValue)
  if ("arrayValue" in o) return JSON.stringify(((o.arrayValue as { values?: unknown[] })?.values ?? []).map(value))
  return JSON.stringify(o)
}
const attrs = (list: unknown, redact: (s: string) => string): Record<string, string> =>
  Object.fromEntries(((Array.isArray(list) ? list : []) as Array<{ key?: string; value?: unknown }>).slice(0, 100).filter((a) => typeof a.key === "string").map((a) => [a.key!, redact(value(a.value)).slice(0, 2000)]))

/** The spans in an OTLP JSON export, redacted. */
export function readExport(body: unknown, redact: (s: string) => string): Span[] {
  const out: Span[] = []
  for (const rs of ((body as { resourceSpans?: unknown[] })?.resourceSpans ?? []) as Array<{ resource?: { attributes?: unknown }; scopeSpans?: Array<{ spans?: unknown[] }> }>) {
    const resource = attrs(rs.resource?.attributes, redact)
    for (const ss of rs.scopeSpans ?? [])
      for (const s of (ss.spans ?? []) as Array<Record<string, unknown>>) {
        const traceId = hex(s.traceId)
        const spanId = hex(s.spanId)
        if (!traceId || !spanId) continue
        const parent = hex(s.parentSpanId)
        const code = (s.status as { code?: number | string } | undefined)?.code
        out.push({
          traceId,
          spanId,
          ...(parent ? { parentSpanId: parent } : {}),
          name: redact(String(s.name ?? "")).slice(0, 300),
          ...(resource["service.name"] ? { service: resource["service.name"] } : {}),
          start: ns(s.startTimeUnixNano),
          end: ns(s.endTimeUnixNano),
          ...(code === 2 || code === "STATUS_CODE_ERROR" ? { status: "error" as const } : code === 1 || code === "STATUS_CODE_OK" ? { status: "ok" as const } : {}),
          attributes: attrs(s.attributes, redact),
        })
      }
  }
  return out
}

/** A trace's spans as a tree, roots first by start time; a span whose parent is missing is a root. */
export function spanTree(spans: Span[]): SpanNode[] {
  const nodes = new Map(spans.map((s) => [s.spanId, { ...s, children: [] as SpanNode[] }]))
  const roots: SpanNode[] = []
  for (const n of nodes.values()) {
    const p = n.parentSpanId ? nodes.get(n.parentSpanId) : undefined
    if (p && p !== n) p.children.push(n)
    else roots.push(n)
  }
  const sort = (list: SpanNode[]) => {
    list.sort((a, b) => a.start - b.start)
    for (const n of list) sort(n.children)
  }
  sort(roots)
  return roots
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex")

/** Each project's token, kept as a hash, in the data folder. */
export class TraceTokens {
  constructor(readonly file: string) {}
  #read(): Record<string, string> {
    try {
      return (JSON.parse(fs.readFileSync(this.file, "utf8")) as { tokens?: Record<string, string> }).tokens ?? {}
    } catch {
      return {}
    }
  }
  /** A new token for a project, replacing its old one; the token itself is returned once and never kept. */
  issue(project: string): string {
    const token = crypto.randomBytes(24).toString("base64url")
    const all = { ...this.#read(), [project.toLowerCase()]: sha(token) }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, tokens: all }, null, 1))
    fs.renameSync(`${this.file}.tmp`, this.file)
    return token
  }
  /** The project a token is for; undefined when it is no project's. */
  projectOf(token: string): string | undefined {
    const h = sha(token)
    for (const [project, hash] of Object.entries(this.#read())) if (hash.length === h.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(h))) return project
    return undefined
  }
}

export class TraceStore {
  readonly #spans = new Map<string, Span[]>()
  add(project: string, spans: Span[]): void {
    const list = [...(this.#spans.get(project) ?? []), ...spans]
    this.#spans.set(project, list.slice(-20_000))
  }
  traces(project: string): Array<{ traceId: string; root: string; spans: number; start: number; ms: number; error: boolean }> {
    const by = new Map<string, Span[]>()
    for (const s of this.#spans.get(project.toLowerCase()) ?? []) by.set(s.traceId, [...(by.get(s.traceId) ?? []), s])
    return [...by.entries()]
      .map(([traceId, spans]) => {
        const [root] = spanTree(spans)
        const start = Math.min(...spans.map((s) => s.start))
        return { traceId, root: root ? `${root.service ? `${root.service}: ` : ""}${root.name}` : "", spans: spans.length, start, ms: Math.max(...spans.map((s) => s.end)) - start, error: spans.some((s) => s.status === "error") }
      })
      .sort((a, b) => b.start - a.start)
      .slice(0, 200)
  }
  tree(project: string, traceId: string): SpanNode[] {
    return spanTree((this.#spans.get(project.toLowerCase()) ?? []).filter((s) => s.traceId === traceId))
  }
}

export interface ReceiverDeps {
  tokens: Pick<TraceTokens, "projectOf">
  store: Pick<TraceStore, "add">
  redact: (s: string) => string
  log?: (line: string) => void
}

/** Checks a request against section 10: token, Host, no Origin, size and type. Returns the project, or the refusal. */
export function admit(req: { method?: string; url?: string; headers: http.IncomingHttpHeaders }, port: number, tokens: Pick<TraceTokens, "projectOf">): { project: string } | { status: number; why: string } {
  if (req.headers.origin !== undefined) return { status: 403, why: "requests from a web page are refused" }
  const host = String(req.headers.host ?? "").toLowerCase()
  if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return { status: 421, why: "the Host is not this receiver" }
  if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/v1/traces") return { status: 404, why: "only POST /v1/traces is taken" }
  const auth = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))
  const project = auth ? tokens.projectOf(auth[1]!) : undefined
  if (!project) return { status: 401, why: "a project's trace token is needed" }
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return { status: 415, why: "only OTLP JSON is taken" }
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return { status: 413, why: "the body is over 4 MB" }
  return { project }
}

/** The receiver itself, on 127.0.0.1 at a port. */
export function startReceiver(port: number, d: ReceiverDeps): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const done = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }
    const a = admit(req, (server.address() as { port: number }).port, d.tokens)
    if ("status" in a) {
      req.resume()
      return done(a.status, { error: a.why })
    }
    let size = 0
    const chunks: Buffer[] = []
    let over = false
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        over = true
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("close", () => {
      if (over && !res.writableEnded) done(413, { error: "the body is over 4 MB" })
    })
    req.on("end", () => {
      if (over) return
      try {
        const spans = readExport(JSON.parse(Buffer.concat(chunks).toString("utf8")), d.redact)
        d.store.add(a.project, spans)
        done(200, { partialSuccess: {} })
      } catch {
        done(400, { error: "the body is not OTLP JSON" })
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}
