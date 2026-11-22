/**
 * E-013, migration rehearsal (Expansion E3). A project's SQL migrations are run against a throwaway database: each
 * one up, then down, checking the schema is back as it was, then up again before the next. A migration with no down
 * step is reported as irreversible, a down step that leaves the schema different as not reversing it, and any step that
 * fails with its error. SQLite runs in the Host (node:sqlite) on a file in the temporary folder, deleted afterwards.
 * Migrations written for Postgres run only in an E-026 container (no network, a database made inside it and gone with
 * it); without one, and for SQL Server, they are reported as not rehearsed and why.
 *
 * Found by convention: name.up.sql with name.down.sql, one file with goose, sql-migrate or dbmate markers, Flyway's
 * V<n>__ with its U<n>__ undo, and any other migration E-011 recognises (up only).
 */
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { migrationKind } from "@gatehouse/policy"
import type { ContainerRun } from "./codehouse-action.js"

export interface Migration {
  name: string
  up: string
  down?: string
}

export type Dialect = "sqlite" | "postgres" | "sqlserver"

export interface StepResult {
  name: string
  up: "ok" | "failed"
  down: "ok" | "failed" | "missing" | "not run"
  /** The schema after down matched the schema before up. */
  restores?: boolean
  error?: string
}

export interface Rehearsal {
  engine: "sqlite" | "postgres" | "none"
  steps: StepResult[]
  irreversible: string[]
  failures: string[]
  /** Why nothing was run, when nothing was. */
  notRun?: string
}

const MARKERS: Array<[RegExp, RegExp]> = [
  [/^--\s*\+goose\s+Up\b.*$/im, /^--\s*\+goose\s+Down\b.*$/im],
  [/^--\s*\+migrate\s+Up\b.*$/im, /^--\s*\+migrate\s+Down\b.*$/im],
  [/^--\s*migrate:up\b.*$/im, /^--\s*migrate:down\b.*$/im],
]

/** A file's up and down sections, by its markers; undefined when it has none. */
export function splitMarked(text: string): { up: string; down?: string } | undefined {
  for (const [u, d] of MARKERS) {
    const um = u.exec(text)
    if (!um) continue
    const dm = d.exec(text)
    const upStart = um.index + um[0].length
    if (!dm) return { up: text.slice(upStart) }
    return dm.index > um.index ? { up: text.slice(upStart, dm.index), down: text.slice(dm.index + dm[0].length) } : { up: text.slice(upStart), down: text.slice(dm.index + dm[0].length, um.index) }
  }
  return undefined
}

const version = (p: string) =>
  (path.posix.basename(p).match(/^[VU]?(\d+(?:[._]\d+)*)/) ?? path.posix.basename(path.posix.dirname(p)).match(/^(\d+(?:[._]\d+)*)/))?.[1]?.split(/[._]/).map(Number) ?? []
const byVersion = (a: string, b: string) => {
  const x = version(a)
  const y = version(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1)
  return a.localeCompare(b)
}

/** The project's migrations, in order, from its file list. */
export function findMigrations(paths: string[], read: (p: string) => string): Migration[] {
  const sql = paths.filter((p) => /\.sql$/i.test(p) && (migrationKind(p, "") === "sql" || /\.(up|down)\.sql$/i.test(p)))
  const out: Migration[] = []
  const used = new Set<string>()
  for (const p of [...sql].sort(byVersion)) {
    if (used.has(p)) continue
    const base = path.posix.basename(p)
    const dir = path.posix.dirname(p)
    if (/\.down\.sql$/i.test(p) || /^U\d/.test(base)) continue
    const upDown = /^(.*)\.up\.sql$/i.exec(p)
    if (upDown) {
      const down = sql.find((q) => q.toLowerCase() === `${upDown[1]!}.down.sql`.toLowerCase())
      if (down) used.add(down)
      out.push({ name: path.posix.basename(upDown[1]!), up: read(p), ...(down ? { down: read(down) } : {}) })
      continue
    }
    const flyway = /^V([\d._]+)__(.+)$/.exec(base)
    if (flyway) {
      const undo = sql.find((q) => path.posix.dirname(q) === dir && path.posix.basename(q) === `U${flyway[1]}__${flyway[2]}`)
      out.push({ name: base.replace(/\.sql$/i, ""), up: read(p), ...(undo ? { down: read(undo) } : {}) })
      continue
    }
    const text = read(p)
    const marked = splitMarked(text)
    const name = /(^|\/)migration\.sql$/i.test(p) ? path.posix.basename(dir) : base.replace(/\.sql$/i, "")
    out.push(marked ? { name, up: marked.up, ...(marked.down?.trim() ? { down: marked.down } : {}) } : { name, up: text })
  }
  return out
}

/** The dialect the migrations are written for, by words only Postgres or SQL Server use. */
export function dialectOf(ms: Migration[]): Dialect {
  const all = ms.map((m) => `${m.up}\n${m.down ?? ""}`).join("\n")
  if (/\bnvarchar\b|\bidentity\s*\(|^\s*go\s*$|\[dbo\]|\bdatetime2\b/im.test(all)) return "sqlserver"
  if (/\bbigserial\b|\bserial\b|::\w|\bjsonb\b|\bcreate\s+extension\b|\$\$|\btimestamptz\b|\bplpgsql\b/i.test(all)) return "postgres"
  return "sqlite"
}

export interface Engine {
  exec(sql: string): void
  schema(): string
  close(): void
}

/** E-014: SQLite's engine also answers queries (EXPLAIN QUERY PLAN, a table's columns). */
export interface SqliteEngine extends Engine {
  file: string
  all(sql: string): Array<Record<string, unknown>>
}

/** A throwaway SQLite database in the temporary folder; closing deletes it. */
export function sqliteEngine(dir = os.tmpdir()): SqliteEngine {
  const file = path.join(dir, `codeh-rehearsal-${crypto.randomBytes(6).toString("hex")}.db`)
  const db = new DatabaseSync(file)
  return {
    file,
    exec: (sql) => db.exec(sql),
    all: (sql) => db.prepare(sql).all() as Array<Record<string, unknown>>,
    schema: () =>
      (db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Array<{ type: string; name: string; sql: string | null }>)
        .map((r) => `${r.type} ${r.name}: ${(r.sql ?? "").replace(/\s+/g, " ")}`)
        .join("\n"),
    close: () => {
      try {
        db.close()
      } finally {
        for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true })
      }
    },
  }
}

const short = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0]!.slice(0, 300)

/** Each migration up, down (checking the schema is back), and up again, on an engine. */
export function rehearseOn(engine: Engine, ms: Migration[]): Pick<Rehearsal, "steps" | "irreversible" | "failures"> {
  const steps: StepResult[] = []
  for (const m of ms) {
    const before = engine.schema()
    const step: StepResult = { name: m.name, up: "ok", down: m.down?.trim() ? "not run" : "missing" }
    steps.push(step)
    try {
      engine.exec(m.up)
    } catch (e) {
      step.up = "failed"
      step.error = `up: ${short(e)}`
      break
    }
    if (!m.down?.trim()) continue
    try {
      engine.exec(m.down)
    } catch (e) {
      step.down = "failed"
      step.error = `down: ${short(e)}`
      break
    }
    step.down = "ok"
    step.restores = engine.schema() === before
    // Up again for the next migration; after a down that did not undo it, what it made is still there.
    if (!step.restores) continue
    try {
      engine.exec(m.up)
    } catch (e) {
      step.error = `up again after down: ${short(e)}`
      break
    }
  }
  return {
    steps,
    irreversible: steps.filter((s) => s.down === "missing" || s.restores === false).map((s) => s.name),
    failures: steps.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`),
  }
}

/**
 * The Postgres rehearsal as one script for a container: a database made in its temporary folder, each step marked so
 * its outcome can be read back, and the schema dumped after each.
 */
export function postgresScript(ms: Migration[]): { script: string; files: Record<string, string> } {
  const files: Record<string, string> = {}
  const lines = [
    "set -u",
    "export PGDATA=/tmp/pg PGHOST=/tmp PGUSER=postgres",
    "initdb -U postgres -A trust >/dev/null 2>&1 || { echo '@@FAIL setup initdb'; exit 0; }",
    "pg_ctl -w -o '-k /tmp -c listen_addresses=' start >/dev/null 2>&1 || { echo '@@FAIL setup start'; exit 0; }",
    "dump() { pg_dump -s -O -x postgres | grep -v '^--' | grep -v '^SET ' | grep -v '^SELECT pg_catalog' | grep -v '^$' | md5sum | cut -c1-32; }",
    "run() { psql -q -X -v ON_ERROR_STOP=1 -f \"$1\" postgres >/tmp/out 2>&1; }",
  ]
  ms.forEach((m, i) => {
    files[`${i}.up.sql`] = m.up
    lines.push(`echo "@@SCHEMA ${i} before $(dump)"`)
    lines.push(`run /m/${i}.up.sql && echo '@@OK ${i} up' || { echo "@@FAIL ${i} up $(tail -n 1 /tmp/out)"; exit 0; }`)
    if (m.down?.trim()) {
      files[`${i}.down.sql`] = m.down
      lines.push(`run /m/${i}.down.sql && echo '@@OK ${i} down' || { echo "@@FAIL ${i} down $(tail -n 1 /tmp/out)"; exit 0; }`)
      lines.push(`echo "@@SCHEMA ${i} after $(dump)"`)
      lines.push(`run /m/${i}.up.sql || { echo "@@FAIL ${i} down $(tail -n 1 /tmp/out)"; exit 0; }`)
    }
  })
  lines.push("pg_ctl -w stop >/dev/null 2>&1", "echo '@@DONE'")
  return { script: `${lines.join("\n")}\n`, files }
}

/** The container's output read back into steps. */
export function readPostgresOutput(out: string, ms: Migration[]): Pick<Rehearsal, "steps" | "irreversible" | "failures"> {
  const steps: StepResult[] = []
  const lines = out.split(/\r?\n/)
  const setup = lines.find((l) => l.startsWith("@@FAIL setup"))
  if (setup) return { steps, irreversible: [], failures: [`the database could not be made in the container (${setup.slice(13)})`] }
  ms.forEach((m, i) => {
    const has = (s: string) => lines.some((l) => l.startsWith(s))
    const fail = lines.find((l) => l.startsWith(`@@FAIL ${i} `))
    if (!has(`@@SCHEMA ${i} before`)) return
    const step: StepResult = { name: m.name, up: has(`@@OK ${i} up`) ? "ok" : "failed", down: m.down?.trim() ? (has(`@@OK ${i} down`) ? "ok" : fail ? "failed" : "not run") : "missing" }
    if (fail) step.error = fail.slice(`@@FAIL ${i} `.length).slice(0, 300)
    const before = lines.find((l) => l.startsWith(`@@SCHEMA ${i} before `))?.split(" ").pop()
    const after = lines.find((l) => l.startsWith(`@@SCHEMA ${i} after `))?.split(" ").pop()
    if (step.down === "ok" && before && after) step.restores = before === after
    steps.push(step)
  })
  if (!lines.includes("@@DONE") && !steps.some((s) => s.error)) steps.push({ name: "(container)", up: "failed", down: "not run", error: "the container stopped before the rehearsal finished" })
  return {
    steps,
    irreversible: steps.filter((s) => s.down === "missing" || s.restores === false).map((s) => s.name),
    failures: steps.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`),
  }
}

export const POSTGRES_IMAGE = "docker.io/library/postgres:17-alpine"

/** Runs the Postgres script in a container: no network, the migrations read-only, as the postgres user. */
export function runPostgresContainer(c: ContainerRun, ms: Migration[], timeoutMs = 10 * 60_000): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-rehearsal-pg-"))
  const { script, files } = postgresScript(ms)
  fs.writeFileSync(path.join(dir, "run.sh"), script)
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text)
  const args = [...(c.prefix ?? []), "run", "--rm", "--network=none", "--user", "postgres", "-v", `${dir}:/m:ro`, POSTGRES_IMAGE, "sh", "/m/run.sh"]
  return new Promise((resolve) =>
    execFile(c.exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => {
      fs.rmSync(dir, { recursive: true, force: true })
      resolve(`${String(out)}${e && !String(out).includes("@@") ? `\n@@FAIL setup ${String(err || e.message).split("\n")[0]}` : ""}`)
    }),
  )
}

/**
 * Statements that reach outside the throwaway database (another file attached or written, an extension loaded, a
 * folder set); a migration with one is not run here at all.
 */
export const OUTSIDE = /\b(attach|vacuum|load_extension|temp_store_directory|data_store_directory)\b/i

/** The whole rehearsal for a project's migrations. */
export async function rehearse(ms: Migration[], o: { container?: ContainerRun; tmp?: string; postgres?: (c: ContainerRun, ms: Migration[]) => Promise<string> } = {}): Promise<Rehearsal> {
  if (!ms.length) return { engine: "none", steps: [], irreversible: [], failures: [], notRun: "This project has no SQL migrations Codehouse recognises." }
  const dialect = dialectOf(ms)
  if (dialect === "sqlserver") return { engine: "none", steps: [], irreversible: [], failures: [], notRun: "These migrations are written for SQL Server, which Codehouse cannot run in a throwaway database here." }
  if (dialect === "postgres") {
    if (!o.container) return { engine: "none", steps: [], irreversible: [], failures: [], notRun: "These migrations are written for Postgres. Switch container runs on in Settings (with Podman) to rehearse them in a throwaway database." }
    return { engine: "postgres", ...readPostgresOutput(await (o.postgres ?? runPostgresContainer)(o.container, ms), ms) }
  }
  const outside = ms.find((m) => OUTSIDE.test(`${m.up}\n${m.down ?? ""}`))
  if (outside) return { engine: "none", steps: [], irreversible: [], failures: [], notRun: `${outside.name} attaches or writes another database file, or loads an extension, so it is not run here.` }
  const engine = sqliteEngine(o.tmp)
  try {
    return { engine: "sqlite", ...rehearseOn(engine, ms) }
  } finally {
    engine.close()
  }
}
