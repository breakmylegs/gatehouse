/**
 * D-050, the threat model delta (Frontier build, Wave 3). When a change adds something an attacker could use (an HTTP
 * route, a data store, an outbound connection or a listener, a new dependency), Changes proposes draft STRIDE entries
 * for it: spoofing, tampering, repudiation, information disclosure, denial of service and elevation of privilege, each
 * as a question to answer, to copy into the project's threat model. Read from the lines the change adds; nothing runs.
 */
import type { DependencyChange } from "./sbom.js"

export type DeltaKind = "endpoint" | "data store" | "outbound connection" | "listener" | "dependency"

export interface ThreatDraft {
  kind: DeltaKind
  /** file:line, or the lockfile for a dependency. */
  where: string
  what: string
  stride: Array<{ threat: "S" | "T" | "R" | "I" | "D" | "E"; question: string }>
}

const PATTERNS: Array<{ kind: DeltaKind; re: RegExp; what: (m: RegExpExecArray) => string }> = [
  // Express, Fastify, Koa, Hono routers: app.get("/x"), router.post('/y').
  { kind: "endpoint", re: /\b(?:app|router|server|fastify|api|route[rs]?)\s*\.\s*(get|post|put|patch|delete|all|route)\s*\(\s*["'`]([^"'`]+)["'`]/i, what: (m) => `${m[1]!.toUpperCase()} ${m[2]}` },
  // Flask, FastAPI: @app.route("/x"), @app.get("/x").
  { kind: "endpoint", re: /@\w+\.(route|get|post|put|patch|delete)\(\s*["']([^"']+)["']/i, what: (m) => `${m[1]!.toUpperCase()} ${m[2]}` },
  // ASP.NET: [HttpGet("x")], app.MapPost("/x").
  { kind: "endpoint", re: /\[Http(Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/, what: (m) => `${m[1]!.toUpperCase()} ${m[2] || "/"}` },
  { kind: "endpoint", re: /\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/, what: (m) => `${m[1]!.toUpperCase()} ${m[2]}` },
  { kind: "data store", re: /\b(new\s+(?:Pool|Client|Database|PrismaClient|MongoClient|Sequelize|DataSource)\b|createConnection\(|createPool\(|mongoose\.connect\(|redis\.createClient\(|sqlite3?\.connect\(|psycopg2?\.connect\(|DbContext\b)/, what: (m) => m[1]!.replace(/\($/, "") },
  { kind: "outbound connection", re: /\b(fetch\(\s*["'`]https?:\/\/[^"'`]+|axios\.(?:get|post|put|patch|delete|request)\(|https?\.request\(|new\s+WebSocket\(|requests\.(?:get|post|put|delete)\(|HttpClient\(\))/, what: (m) => m[1]!.replace(/\($/, "") },
  { kind: "listener", re: /\b((?:app|server|fastify|httpServer)\.listen\(|createServer\(|new\s+WebSocketServer\(|uvicorn\.run\()/, what: (m) => m[1]!.replace(/\($/, "") },
]

const STRIDE: Record<DeltaKind, ThreatDraft["stride"]> = {
  endpoint: [
    { threat: "S", question: "Who may call it, and how is the caller authenticated?" },
    { threat: "T", question: "Is every field of the request validated, and are its parameters bound rather than built into queries or commands?" },
    { threat: "R", question: "Is each call that changes something recorded with who made it?" },
    { threat: "I", question: "Can its responses or errors show data the caller may not see?" },
    { threat: "D", question: "Is it rate limited, with a size limit on the body?" },
    { threat: "E", question: "Is the caller's permission checked for the thing it acts on, not only that they are signed in?" },
  ],
  "data store": [
    { threat: "S", question: "Does the connection authenticate with a credential that is not in the code?" },
    { threat: "T", question: "Are queries parameterised, and can only the code that should write to it write?" },
    { threat: "R", question: "Are changes to important records kept with who made them?" },
    { threat: "I", question: "Is the data encrypted in transit and at rest, and does the account read only what it needs?" },
    { threat: "D", question: "Are connections pooled and limited, with timeouts?" },
    { threat: "E", question: "Does the account have only the rights it needs (no owner or admin rights)?" },
  ],
  "outbound connection": [
    { threat: "S", question: "Is the server's certificate checked, and the address fixed rather than taken from input?" },
    { threat: "T", question: "Is what comes back validated before it is used?" },
    { threat: "R", question: "Are calls that send data on recorded?" },
    { threat: "I", question: "What data leaves, and may it go to that service?" },
    { threat: "D", question: "Is there a timeout, and what happens when the service is down?" },
    { threat: "E", question: "Could a redirect or a value from input point it at an internal address (server-side request forgery)?" },
  ],
  listener: [
    { threat: "S", question: "Which address does it bind to (127.0.0.1 or every network), and who can reach it?" },
    { threat: "T", question: "Is the traffic encrypted, and are the Host and Origin headers checked?" },
    { threat: "R", question: "Are connections and their requests logged?" },
    { threat: "I", question: "Could it serve files or errors it should not?" },
    { threat: "D", question: "Are connection and request limits set?" },
    { threat: "E", question: "Does it run with no more rights than it needs?" },
  ],
  dependency: [
    { threat: "S", question: "Is it the package it claims to be (name, publisher, source registry)?" },
    { threat: "T", question: "Is its version pinned with an integrity hash in the lockfile?" },
    { threat: "R", question: "Is the reason for adding it recorded?" },
    { threat: "I", question: "Does it send anything over the network, or read files it does not need?" },
    { threat: "D", question: "Is it maintained, and is there a fallback if it breaks?" },
    { threat: "E", question: "Does it run install scripts or native code with your rights?" },
  ],
}

/** The drafts for what a change adds: its added lines by file, and its dependency changes (D-056). */
export function threatDelta(o: { added: Array<{ file: string; lines: Array<{ line: number; text: string }> }>; dependencies?: DependencyChange[] }): ThreatDraft[] {
  const out: ThreatDraft[] = []
  const seen = new Set<string>()
  for (const f of o.added)
    for (const l of f.lines) {
      if (/^\s*(\/\/|#|\*|\/\*)/.test(l.text)) continue
      for (const p of PATTERNS) {
        const m = p.re.exec(l.text)
        if (!m) continue
        const what = p.what(m)
        const key = `${p.kind}:${f.file}:${what}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ kind: p.kind, where: `${f.file}:${l.line}`, what, stride: STRIDE[p.kind] })
      }
    }
  for (const d of o.dependencies ?? [])
    if (d.kind === "added") out.push({ kind: "dependency", where: d.lockfile, what: `${d.package.name} ${d.package.version}`, stride: STRIDE.dependency })
  return out
}

/** A draft as Markdown, to paste into a threat model. */
export function draftMarkdown(d: ThreatDraft): string {
  const words = { S: "Spoofing", T: "Tampering", R: "Repudiation", I: "Information disclosure", D: "Denial of service", E: "Elevation of privilege" }
  return [`### New ${d.kind}: ${d.what} (${d.where})`, "", "| STRIDE | To answer |", "|---|---|", ...d.stride.map((s) => `| ${words[s.threat]} | ${s.question} |`), ""].join("\n")
}
