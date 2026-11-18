/**
 * E-017 (expansion, Wave E1): a bulk export of data goes to a person, showing what it takes and where it puts it:
 * pg_dump, mysqldump, bcp ... out, sqlcmd -o, mongoexport and mongodump, COPY ... TO and SELECT ... INTO OUTFILE in
 * a query given on the command line, and Export-Csv. An export to a place outside the project is higher risk, since the
 * data then leaves where the project keeps its work. Read from the command's own words; nothing is run or opened.
 */
import { isInside, lexicalResolve } from "./paths.js"
import type { Segment } from "./segments.js"

export const BULK_EXPORT_RULE = "bulk-export"
export const EXPORT_INSIDE_RISK = 60
export const EXPORT_OUTSIDE_RISK = 75

export interface ExportFinding {
  ruleId: typeof BULK_EXPORT_RULE
  reason: string
  risk: number
}

const flag = (args: string[], ...names: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    for (const n of names) {
      if (a === n && i + 1 < args.length) return args[i + 1]
      if (n.startsWith("--") && a.startsWith(`${n}=`)) return a.slice(n.length + 1)
    }
  }
  return undefined
}

/** Where a redirect in the segment writes: "pg_dump app > C:\\Users\\me\\Downloads\\app.sql". */
const redirectTarget = (seg: Segment): string | undefined => /(?:^|\s)\d?>>?\s*("[^"]+"|'[^']+'|\S+)/.exec(seg.text)?.[1]?.replace(/^["']|["']$/g, "")

/** What an export segment takes and where it writes; undefined when it is not one. */
export function exportOf(seg: Segment): { tool: string; what: string; to?: string } | undefined {
  const name = seg.name.toLowerCase().replace(/\.exe$/, "")
  const args = seg.args
  const plain = args.filter((a) => !a.startsWith("-"))
  const query = () => flag(args, "-c", "--command", "-e", "--execute", "-Q", "-q") ?? ""
  switch (name) {
    case "pg_dump":
    case "pg_dumpall":
      return { tool: name, what: flag(args, "-d", "--dbname") ?? plain.at(-1) ?? "a database", ...pick(flag(args, "-f", "--file") ?? redirectTarget(seg)) }
    case "mysqldump":
      return { tool: name, what: plain.join(" ") || "a database", ...pick(flag(args, "-r", "--result-file") ?? redirectTarget(seg)) }
    case "mongoexport":
    case "mongodump":
      return { tool: name, what: flag(args, "--db", "-d", "--collection", "-c") ?? "a database", ...pick(flag(args, "--out", "-o") ?? redirectTarget(seg)) }
    case "bcp": {
      // bcp <table or query> out <file>
      const i = args.findIndex((a) => ["out", "queryout"].includes(a.toLowerCase()))
      return i > 0 ? { tool: name, what: args[i - 1]!, ...pick(args[i + 1]) } : undefined
    }
    case "sqlcmd": {
      const out = flag(args, "-o")
      return out ? { tool: name, what: query() || "a query", to: out } : undefined
    }
    case "psql":
    case "mysql": {
      const q = query()
      const m = /\bCOPY\s+(.+?)\s+TO\s+'([^']+)'/i.exec(q) ?? /\bINTO\s+OUTFILE\s+'([^']+)'/i.exec(q)
      if (!m) return undefined
      return m.length === 3 ? { tool: name, what: m[1]!, to: m[2]! } : { tool: name, what: "a query", to: m[1]! }
    }
    case "export-csv":
      return { tool: "Export-Csv", what: "what was piped to it", ...pick(flag(args, "-Path", "-LiteralPath") ?? plain[0]) }
    default:
      return undefined
  }
}

const pick = (to: string | undefined) => (to ? { to } : {})

/**
 * Whether a path is inside the project folder. The policy's own resolution, so C:/... and /c/... read the same on
 * either machine (node's path.resolve took C:/Users/me/Downloads as a folder inside the project on a Mac).
 */
function inside(to: string, cwd: string): boolean {
  const root = lexicalResolve(cwd, "/").key
  const key = lexicalResolve(to, cwd).key
  return key !== root && isInside(key, root)
}

/** A redirect after the tool's name in the whole command: the segment's text leaves redirects out. */
function redirectIn(command: string, tool: string): string | undefined {
  const name = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const m = new RegExp(`(?:^|[\\s;&|(])${name}(?:\\.exe)?\\b[^;&|]*?\\s\\d?>>?\\s*("[^"]+"|'[^']+'|[^\\s;&|)]+)`, "i").exec(command)
  return m?.[1]?.replace(/^["']|["']$/g, "")
}

/** A bulk export with what it takes and where it goes; undefined when there is none. */
export function bulkExport(segments: Segment[], cwd: string, command = ""): ExportFinding | undefined {
  // Export-Csv counts only for query results: a pipeline that runs a database query (Get-Process | Export-Csv is not).
  const queries = segments.some((s) => /^(invoke-sqlcmd|invoke-dbaquery|invoke-sqlquery)$/i.test(s.name))
  for (const s of segments) {
    const found = exportOf(s)
    if (!found || (found.tool === "Export-Csv" && !queries)) continue
    const redirected = found.to === undefined ? redirectIn(command, found.tool) : undefined
    const e = redirected ? { ...found, to: redirected } : found
    const outside = e.to !== undefined && !inside(e.to, cwd)
    return {
      ruleId: BULK_EXPORT_RULE,
      reason: e.to
        ? `This exports ${e.what} with ${e.tool} to ${e.to}${outside ? ", outside the project," : ""} so it waits for you.`
        : `This exports ${e.what} with ${e.tool} (to the screen or another program), so it waits for you.`,
      risk: outside ? EXPORT_OUTSIDE_RISK : EXPORT_INSIDE_RISK,
    }
  }
  return undefined
}
