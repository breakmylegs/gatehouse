/**
 * E-014, query plan review (Expansion E3). The SQL queries a session's change adds, found with tree-sitter in its
 * TypeScript, JavaScript, Python and C# (string literals that start like a query, on the lines the change adds), are
 * explained in a throwaway SQLite database built from the project's migrations (E-013): EXPLAIN QUERY PLAN, which
 * compiles a query without running it. A full scan of a table is flagged with an index on the columns its WHERE
 * compares, and a temporary sort is noted. Postgres and SQL Server migrations are not explained here (E-013 builds
 * those only in a container, where plans would need the container's client too).
 */
import { execFile } from "node:child_process"
import type { Node } from "web-tree-sitter"
import { dialectOf, OUTSIDE, sqliteEngine, type Migration } from "./migration-rehearsal.js"
import { languageOf, parserFor } from "./outline.js"

export interface FoundQuery {
  file: string
  line: number
  sql: string
}

const OUTER = new Set(["string", "template_string", "string_literal", "verbatim_string_literal", "raw_string_literal", "interpolated_string_expression"])
const HOLE = new Set(["template_substitution", "interpolation"])
const QUERY = /^\s*(select|with|update|delete|insert)\b/i

/** A string literal's text with its interpolations as ? and its quotes taken off. */
function literal(n: Node): string {
  let text = n.text
  const holes = n.namedChildren.filter((c): c is Node => !!c && HOLE.has(c.type)).sort((a, b) => b.startIndex - a.startIndex)
  for (const h of holes) text = `${text.slice(0, h.startIndex - n.startIndex)}?${text.slice(h.endIndex - n.startIndex)}`
  return text.replace(/^[A-Za-z$@]*("""|'''|"|'|`)/, "").replace(/("""|'''|"|'|`)$/, "")
}

/** The queries in a file's text, each with its line; only those on the given lines when they are given. */
export async function queriesIn(file: string, text: string, lines?: Set<number>): Promise<FoundQuery[]> {
  const lang = languageOf(file)
  if (!lang || lang === "json" || lang === "powershell") return []
  const tree = (await parserFor(lang)).parse(text)
  if (!tree) return []
  const out: FoundQuery[] = []
  const walk = (n: Node) => {
    if (OUTER.has(n.type)) {
      const sql = literal(n)
      const line = n.startPosition.row + 1
      const touched = !lines || [...Array(n.endPosition.row - n.startPosition.row + 1).keys()].some((i) => lines.has(line + i))
      if (QUERY.test(sql) && touched) out.push({ file, line, sql: sql.trim() })
      return
    }
    for (const c of n.namedChildren) if (c) walk(c)
  }
  walk(tree.rootNode)
  tree.delete()
  return out
}

/** Placeholders of every common driver as SQLite's ?: $1, :name, @name, %s and %(name)s. */
export const placeholders = (sql: string) => sql.replace(/%\(\w+\)s|%s|\$\d+|(?<![:\w]):[A-Za-z_]\w*|(?<![@\w])@[A-Za-z_]\w*/g, "?")

export interface PlanFinding {
  file: string
  line: number
  sql: string
  plan: string[]
  scans: string[]
  /** An index for each scanned table, on the columns the WHERE compares. */
  suggest: string[]
  sort?: boolean
  error?: string
}

/** The columns a query's WHERE compares, that the table has. */
function whereColumns(sql: string, columns: string[]): string[] {
  const where = /\bwhere\b([\s\S]*?)(\border\s+by\b|\bgroup\s+by\b|\blimit\b|\bhaving\b|$)/i.exec(sql)?.[1] ?? ""
  const found: string[] = []
  for (const m of where.matchAll(/(?:\b\w+\.)?\b(\w+)\s*(?:=|<>|!=|<=|>=|<|>|\bin\b|\blike\b|\bis\b|\bbetween\b)/gi)) {
    const c = columns.find((x) => x.toLowerCase() === m[1]!.toLowerCase())
    if (c && !found.includes(c)) found.push(c)
  }
  return found
}

/** Each query explained in a database built from the migrations. */
export function explainAll(ms: Migration[], queries: FoundQuery[], tmp?: string): { findings: PlanFinding[]; notRun?: string } {
  if (!queries.length) return { findings: [] }
  if (!ms.length) return { findings: [], notRun: "This project has no SQL migrations Codehouse recognises, so there is no schema to explain the queries against." }
  if (dialectOf(ms) !== "sqlite") return { findings: [], notRun: "These migrations are written for Postgres or SQL Server; their query plans are not explained here." }
  const outside = ms.find((m) => OUTSIDE.test(m.up))
  if (outside) return { findings: [], notRun: `${outside.name} attaches or writes another database file, or loads an extension, so it is not run here.` }
  const engine = sqliteEngine(tmp)
  try {
    for (const m of ms) engine.exec(m.up)
    return {
      findings: queries.map((q) => {
        const sql = placeholders(q.sql).replace(/;\s*$/, "")
        const f: PlanFinding = { ...q, plan: [], scans: [], suggest: [] }
        if (sql.includes(";") || OUTSIDE.test(sql)) return { ...f, error: "It holds more than one statement, or reaches outside the database, so it was not explained." }
        try {
          f.plan = engine.all(`EXPLAIN QUERY PLAN ${sql}`).map((r) => String(r.detail))
        } catch (e) {
          return { ...f, error: String((e as Error).message).split("\n")[0]!.slice(0, 200) }
        }
        for (const d of f.plan) {
          const scan = /^SCAN (?:TABLE )?(\w+)(?: AS \w+)?$/.exec(d)
          if (scan) {
            f.scans.push(scan[1]!)
            const cols = whereColumns(q.sql, engine.all(`SELECT name FROM pragma_table_info('${scan[1]!.replace(/'/g, "''")}')`).map((r) => String(r.name)))
            if (cols.length) f.suggest.push(`CREATE INDEX ${scan[1]}_${cols.join("_")} ON ${scan[1]} (${cols.join(", ")});`)
          }
          if (/USE TEMP B-TREE FOR ORDER BY/.test(d)) f.sort = true
        }
        return f
      }),
    }
  } catch (e) {
    return { findings: [], notRun: `The migrations could not be applied to a throwaway database: ${String((e as Error).message).split("\n")[0]}` }
  } finally {
    engine.close()
  }
}

export const gitOut = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) =>
    execFile("git", ["-c", "core.quotePath=false", ...args], { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (e, out) => resolve(e ? undefined : String(out))),
  )
