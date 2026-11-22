/**
 * E-012, the schema diff view (Expansion E3). The database schema before and after a session's change, read from what
 * the project keeps: SQL migrations (as E-011 finds them) applied in order, plain DDL, a Prisma schema or an EF Core
 * model snapshot. Before is the last commit, after is the working folder. The difference is drawn as a Mermaid ER
 * diagram (C-057) with each added, removed or changed column marked, and only the tables that changed.
 *
 * Read by statements and by name, not by a parser, as E-011 reads migrations: enough to say which tables and columns
 * there are and their types.
 */
import { execFile } from "node:child_process"
import { migrationKind } from "@gatehouse/policy"

/** Table to column to type. */
export type Schema = Map<string, Map<string, string>>

const name = (s: string) => s.replace(/^[`"[]|[`"\]]$/g, "").split(".").pop()!.replace(/^[`"[]|[`"\]]$/g, "")
const NAME = String.raw`((?:[\`"\[]?[\w$]+[\`"\]]?\.)?[\`"\[]?[\w$]+[\`"\]]?)`

/** Splits a column list at its top-level commas. */
function topLevel(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of body) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

const CONSTRAINT = /^(constraint|primary\s+key|foreign\s+key|unique|check|index|key)\b/i

/** A column definition's name and type, or undefined for a constraint. */
function column(def: string): [string, string] | undefined {
  if (CONSTRAINT.test(def)) return undefined
  const m = new RegExp(`^${NAME}\\s+([\\w ]+?(?:\\([^)]*\\))?)(?=\\s+(?:not|null|default|primary|references|unique|check|constraint|generated|identity|auto_increment|collate)\\b|\\s*$)`, "i").exec(def)
  return m ? [name(m[1]!), m[2]!.replace(/\s+/g, " ").trim().toLowerCase()] : undefined
}

/** Applies SQL statements to a schema, in order. */
export function applySql(schema: Schema, sql: string): Schema {
  const text = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  for (const raw of text.split(";")) {
    const s = raw.trim()
    let m: RegExpExecArray | null
    if ((m = new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${NAME}\\s*\\(([\\s\\S]*)\\)`, "i").exec(s))) {
      const cols = new Map<string, string>()
      for (const def of topLevel(m[2]!)) {
        const c = column(def)
        if (c) cols.set(c[0], c[1])
      }
      schema.set(name(m[1]!), cols)
    } else if ((m = new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?${NAME}`, "i").exec(s))) schema.delete(name(m[1]!))
    else if ((m = new RegExp(`^alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?${NAME}\\s+([\\s\\S]+)$`, "i").exec(s))) {
      const table = name(m[1]!)
      const cols = schema.get(table) ?? new Map<string, string>()
      schema.set(table, cols)
      for (const action of topLevel(m[2]!)) {
        let a: RegExpExecArray | null
        if ((a = new RegExp(`^rename\\s+to\\s+${NAME}`, "i").exec(action))) {
          schema.delete(table)
          schema.set(name(a[1]!), cols)
        } else if ((a = new RegExp(`^rename\\s+(?:column\\s+)?${NAME}\\s+to\\s+${NAME}`, "i").exec(action))) {
          const t = cols.get(name(a[1]!))
          cols.delete(name(a[1]!))
          if (t !== undefined) cols.set(name(a[2]!), t)
        } else if ((a = new RegExp(`^drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?${NAME}`, "i").exec(action)) && !/^drop\s+constraint\b/i.test(action)) cols.delete(name(a[1]!))
        else if ((a = new RegExp(`^(?:alter|modify)\\s+(?:column\\s+)?${NAME}\\s+(?:(?:set\\s+data\\s+)?type\\s+)?([\\w ]+?(?:\\([^)]*\\))?)(?=\\s+(?:using|not|null|default|collate)\\b|\\s*$)`, "i").exec(action)) && !/\b(set|drop)\s+(default|not\s+null)\b/i.test(action))
          cols.set(name(a[1]!), a[2]!.replace(/\s+/g, " ").trim().toLowerCase())
        else if ((a = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(action))) {
          const c = column(a[1]!)
          if (c) cols.set(c[0], c[1])
        }
      }
    }
  }
  return schema
}

/** A Prisma schema's models: each scalar field and its type; relation lists and block attributes left out. */
export function prismaSchema(text: string): Schema {
  const schema: Schema = new Map()
  for (const m of text.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    const cols = new Map<string, string>()
    const mapped = /@@map\(\s*"([^"]+)"\s*\)/.exec(m[2]!)?.[1]
    for (const line of m[2]!.split("\n")) {
      const f = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?/.exec(line)
      if (!f || line.trim().startsWith("//") || line.trim().startsWith("@@") || f[3] || /@relation\b/.test(line)) continue
      cols.set(/@map\(\s*"([^"]+)"\s*\)/.exec(line)?.[1] ?? f[1]!, `${f[2]!.toLowerCase()}${f[4] ? "?" : ""}`)
    }
    schema.set(mapped ?? m[1]!, cols)
  }
  return schema
}

/** An EF Core model snapshot's entities: each property and its CLR type, under the table it maps to. */
export function efSnapshot(text: string): Schema {
  const schema: Schema = new Map()
  const blocks = text.split(/modelBuilder\.Entity\(\s*"/).slice(1)
  for (const b of blocks) {
    const entity = /^([\w.]+)"/.exec(b)?.[1]
    if (!entity) continue
    const head = b.split(/\n\s*b\.(?:Has(?:One|Many)|Navigation)\(/)[0]!
    const props = [...head.matchAll(/\.Property<([\w?<>.,\s[\]]+)>\(\s*"(\w+)"\s*\)/g)]
    if (!props.length) continue
    const table = /\.ToTable\(\s*"(\w+)"/.exec(head)?.[1] ?? entity.split(".").pop()!
    const cols = schema.get(table) ?? new Map<string, string>()
    for (const p of props) cols.set(p[2]!, p[1]!.replace(/\s+/g, "").toLowerCase())
    schema.set(table, cols)
  }
  return schema
}

export interface TableDiff {
  table: string
  state: "added" | "removed" | "changed"
  added: Array<[string, string]>
  removed: Array<[string, string]>
  changed: Array<[string, string, string]>
  kept: Array<[string, string]>
}

/** What changed between two schemas, table by table; unchanged tables left out. */
export function diffSchemas(before: Schema, after: Schema): TableDiff[] {
  const out: TableDiff[] = []
  for (const table of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(table)
    const a = after.get(table)
    const d: TableDiff = { table, state: !b ? "added" : !a ? "removed" : "changed", added: [], removed: [], changed: [], kept: [] }
    for (const [c, t] of a ?? []) {
      const was = b?.get(c)
      if (was === undefined) d.added.push([c, t])
      else if (was !== t) d.changed.push([c, was, t])
      else d.kept.push([c, t])
    }
    for (const [c, t] of b ?? []) if (!a?.has(c)) d.removed.push([c, t])
    if (d.state !== "changed" || d.added.length || d.removed.length || d.changed.length) out.push(d)
  }
  return out
}

const ident = (s: string) => s.replace(/[^\w-]/g, "_").slice(0, 60) || "_"
const typeOf = (s: string) => s.replace(/\?$/, "").replace(/[^\w]/g, "_").slice(0, 40) || "unknown"

/** The difference as a Mermaid ER diagram, each column marked added, removed or changed. */
export function erDiff(diffs: TableDiff[]): string {
  const lines = ["erDiagram"]
  for (const d of diffs) {
    lines.push(`  ${ident(d.table)} {`)
    const mark = d.state === "changed" ? "" : d.state === "added" ? "added" : "removed"
    for (const [c, t] of d.kept) lines.push(`    ${typeOf(t)} ${ident(c)}${mark ? ` "${mark}"` : ""}`)
    for (const [c, t] of d.added) lines.push(`    ${typeOf(t)} ${ident(c)} "added"`)
    for (const [c, from, to] of d.changed) lines.push(`    ${typeOf(to)} ${ident(c)} "changed from ${typeOf(from)}"`)
    for (const [c, t] of d.removed) lines.push(`    ${typeOf(t)} ${ident(c)} "removed"`)
    lines.push("  }")
  }
  return `${lines.join("\n")}\n`
}

/** The difference in words, one line a table. */
export function diffSummary(diffs: TableDiff[]): string[] {
  return diffs.map((d) => {
    if (d.state !== "changed") return `${d.table}: table ${d.state}`
    const parts = [
      ...d.added.map(([c]) => `${c} added`),
      ...d.removed.map(([c]) => `${c} removed`),
      ...d.changed.map(([c, f, t]) => `${c} changed from ${f} to ${t}`),
    ]
    return `${d.table}: ${parts.join(", ")}`
  })
}

export type SchemaSource = "migrations" | "ddl" | "prisma" | "ef"

/** What a project keeps its schema in, by file path; the first kind found wins (Prisma, EF Core, migrations, DDL). */
export function schemaFiles(paths: string[], read: (p: string) => string): { source: SchemaSource; files: string[] } | undefined {
  const prisma = paths.filter((p) => /(^|\/)schema\.prisma$/.test(p))
  if (prisma.length) return { source: "prisma", files: prisma.slice(0, 1) }
  const ef = paths.filter((p) => /ModelSnapshot\.cs$/.test(p))
  if (ef.length) return { source: "ef", files: ef.slice(0, 1) }
  const migrations = paths.filter((p) => /\.sql$/i.test(p) && migrationKind(p, "") === "sql").sort()
  if (migrations.length) return { source: "migrations", files: migrations }
  const ddl = paths.filter((p) => /(^|\/)(schema|ddl|tables)[\w-]*\.(sql|ddl)$/i.test(p) || /\.ddl$/i.test(p)).filter((p) => /\bcreate\s+table\b/i.test(read(p)))
  return ddl.length ? { source: "ddl", files: ddl.sort() } : undefined
}

/** The schema from a source's files' texts. */
export function schemaOf(source: SchemaSource, texts: string[]): Schema {
  if (source === "prisma") return prismaSchema(texts.join("\n"))
  if (source === "ef") return efSnapshot(texts.join("\n"))
  const s: Schema = new Map()
  for (const t of texts) applySql(s, t)
  return s
}

const git = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) =>
    execFile("git", args, { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => resolve(e ? undefined : String(out))),
  )

export interface SchemaDiff {
  source: SchemaSource
  files: string[]
  tables: TableDiff[]
  summary: string[]
  mermaid: string
}

/** A project's schema at its last commit against its working folder; undefined when it keeps no schema Codehouse reads. */
export async function projectSchemaDiff(cwd: string, readFile: (p: string) => string | undefined): Promise<SchemaDiff | undefined> {
  const listed = await git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  if (listed === undefined) throw new Error("The folder is not a git repository, so there is no last commit to compare with.")
  const paths = listed.split("\0").filter(Boolean)
  const found = schemaFiles(paths, (p) => readFile(p) ?? "")
  if (!found) return undefined
  const head = new Set((await git(cwd, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]))?.split("\0").filter(Boolean) ?? [])
  const before: string[] = []
  const after: string[] = []
  for (const f of found.files) {
    if (head.has(f)) before.push((await git(cwd, ["show", `HEAD:${f}`])) ?? "")
    after.push(readFile(f) ?? "")
  }
  const tables = diffSchemas(schemaOf(found.source, before), schemaOf(found.source, after))
  return { source: found.source, files: found.files, tables, summary: diffSummary(tables), mermaid: erDiff(tables) }
}
