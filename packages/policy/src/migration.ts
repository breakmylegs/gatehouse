/**
 * E-011 (expansion, Wave E1): an agent's edit to a database migration that destroys or locks out data goes to a person,
 * showing the statements and the tables. Held: DROP TABLE and DROP COLUMN, TRUNCATE, a column's type changed to a
 * bounded one (it may narrow), NOT NULL added without a default, a rename with no view kept for the old name, and
 * DELETE with no WHERE. Migrations are found by their place and words: plain SQL under a migrations folder, Prisma's
 * migration.sql, Flyway's V1__name.sql, Liquibase changelogs (XML and YAML), EF Core's migrationBuilder, Alembic's op
 * and Knex's schema builder. Only what the edit adds counts.
 *
 * Read by statements, not by a parser: comments are taken out and SQL is cut at its semicolons, and the ORM calls are
 * matched by name. A full SQL grammar for every dialect would add a large dependency to say the same about these few
 * statements (BUILD_REPORT, E-011).
 */
import fs from "node:fs"

export const MIGRATION_RULE = "destructive-migration"
export const MIGRATION_RISK = 85

export interface MigrationFinding {
  ruleId: typeof MIGRATION_RULE
  reason: string
  risk: number
}

type Kind = "sql" | "liquibase-xml" | "liquibase-yaml" | "ef" | "alembic" | "knex"

const base = (file: string) => file.replace(/\\/g, "/")

/** What kind of migration a file is, by its path and its words; undefined when it is not one. */
export function migrationKind(file: string, text: string): Kind | undefined {
  const p = base(file)
  if (/\.sql$/i.test(p)) {
    if (/(^|\/)(migrations?|db\/migrate|flyway|changelogs?)\//i.test(p) || /(^|\/)[VUR]\d[\w.]*__[^/]+\.sql$/.test(p)) return "sql"
    return undefined
  }
  if (/\.xml$/i.test(p)) return /<databaseChangeLog\b/.test(text) ? "liquibase-xml" : undefined
  if (/\.ya?ml$/i.test(p)) return /^\s*databaseChangeLog:/m.test(text) ? "liquibase-yaml" : undefined
  if (/\.cs$/i.test(p)) return /\bmigrationBuilder\./.test(text) ? "ef" : undefined
  if (/\.py$/i.test(p)) return /(^|\/)(versions|migrations|alembic)\//i.test(p) && /\bdef upgrade\(/.test(text) ? "alembic" : undefined
  if (/\.[cm]?[jt]s$/i.test(p)) return /(^|\/)migrations?\//i.test(p) && /\b(knex|exports\.up|export\s+(async\s+)?function\s+up)\b/.test(text) ? "knex" : undefined
  return undefined
}

const clip = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim()
  return one.length > 90 ? `${one.slice(0, 87)}...` : one
}

const BOUNDED = /\b(n?varchar|n?char|character varying|varbinary|binary)\s*\(\s*\d+\s*\)|\b(smallint|tinyint|int2|int4|integer|int|real|float4|numeric\s*\(|decimal\s*\(|date|bit|boolean|bool)\b/i

/** The destructive statements in SQL text, each shown short. */
function sqlFindings(sql: string): string[] {
  const text = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  const statements = text.split(";").map((s) => s.trim()).filter(Boolean)
  const view = statements.some((s) => /^create\s+(or\s+replace\s+)?view\b/i.test(s))
  const out: string[] = []
  for (const s of statements) {
    if (/^drop\s+table\b/i.test(s)) out.push(clip(s))
    else if (/^truncate\b/i.test(s)) out.push(clip(s))
    else if (/^delete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s)) out.push(`${clip(s)} (no WHERE)`)
    else if (/^alter\s+table\b/i.test(s)) {
      if (/\bdrop\s+(column\b|(?!constraint|index|primary|foreign|default|check|not|identity|expression)\w)/i.test(s)) out.push(clip(s))
      else if (/\brename\b/i.test(s) && !view) out.push(`${clip(s)} (no view kept for the old name)`)
      else if (/\badd\b/i.test(s) && /\bnot\s+null\b/i.test(s) && !/\bdefault\b/i.test(s)) out.push(`${clip(s)} (NOT NULL with no default)`)
      else if (/\balter\s+column\b[^,]*\bset\s+not\s+null\b/i.test(s)) out.push(`${clip(s)} (NOT NULL on rows that may have none)`)
      else if (/\b(alter\s+column|modify(\s+column)?)\s+\S+\s+(set\s+data\s+)?(type\s+)?/i.test(s) && BOUNDED.test(s.replace(/^.*?\b(alter\s+column|modify(\s+column)?)\s+\S+/i, "")))
        out.push(`${clip(s)} (a type change that may narrow)`)
    } else if (/^(exec(ute)?\s+)?sp_rename\b/i.test(s) && !view) out.push(`${clip(s)} (no view kept for the old name)`)
  }
  return out
}

/** The SQL written inside code (EF's Sql, Alembic's execute, Knex's raw), as text. */
const embeddedSql = (text: string) =>
  [...text.matchAll(/\b(?:Sql|execute|raw)\s*\(\s*(?:@|[rbf]?)?("""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g)].map((m) => (m[1] ?? "").replace(/^("""|["'`])|("""|["'`])$/g, "")).join(";\n")

function calls(text: string, re: RegExp, also?: (call: string) => string | undefined): string[] {
  const out: string[] = []
  for (const m of text.matchAll(re)) {
    // The call to its closing bracket (or the end of the line), so its arguments can be read.
    const start = m.index ?? 0
    let depth = 0
    let end = start
    for (; end < text.length; end++) {
      const c = text[end]
      if (c === "(") depth++
      else if (c === ")" && --depth === 0) break
    }
    const call = text.slice(start, end + 1)
    const note = also ? also(call) : ""
    if (note !== undefined) out.push(`${clip(call)}${note}`)
  }
  return out
}

function codeFindings(kind: Kind, text: string): string[] {
  const out = sqlFindings(embeddedSql(text))
  if (kind === "ef") {
    out.push(...calls(text, /\bmigrationBuilder\.(DropTable|DropColumn)\s*\(/g))
    out.push(...calls(text, /\bmigrationBuilder\.(RenameTable|RenameColumn)\s*\(/g, () => " (no view kept for the old name)"))
    out.push(...calls(text, /\bmigrationBuilder\.(AddColumn|AlterColumn)\s*</g, (c) => (/\bnullable:\s*false\b/.test(c) && !/\bdefaultValue(Sql)?:/.test(c) ? " (NOT NULL with no default)" : undefined)))
  } else if (kind === "alembic") {
    out.push(...calls(text, /\bop\.(drop_table|drop_column)\s*\(/g))
    out.push(...calls(text, /\bop\.rename_table\s*\(/g, () => " (no view kept for the old name)"))
    out.push(...calls(text, /\bop\.(add_column|alter_column)\s*\(/g, (c) => {
      if (/\bnew_column_name\s*=/.test(c)) return " (no view kept for the old name)"
      if (/\bnullable\s*=\s*False\b/.test(c) && !/\bserver_default\s*=/.test(c)) return " (NOT NULL with no default)"
      return /\btype_\s*=/.test(c) && BOUNDED.test(c.replace(/^[\s\S]*?type_\s*=/, "")) ? " (a type change that may narrow)" : undefined
    }))
  } else if (kind === "knex") {
    out.push(...calls(text, /\.(dropTable|dropTableIfExists|dropColumns?|truncate)\s*\(/g))
    out.push(...calls(text, /\.(renameTable|renameColumn)\s*\(/g, () => " (no view kept for the old name)"))
    // NOT NULL only counts in a table being altered: a new table has no rows to lock out.
    for (const part of text.split(/(?=\.(?:createTable|alterTable|table)\s*\()/))
      if (/^\.(alterTable|table)\s*\(/.test(part))
        for (const line of part.split("\n")) if (/\.notNullable\(\)/.test(line) && !/\.defaultTo\(/.test(line)) out.push(`${clip(line)} (NOT NULL with no default)`)
    for (const statement of text.split(";")) if (/\.del(ete)?\(\)/.test(statement) && !/\.where\w*\(/.test(statement)) out.push(`${clip(statement)} (no WHERE)`)
  }
  return out
}

function liquibaseFindings(kind: Kind, text: string): string[] {
  const out = sqlFindings([...text.matchAll(/<sql\b[^>]*>([\s\S]*?)<\/sql>/g)].map((m) => m[1]).join(";\n"))
  if (kind === "liquibase-xml") {
    for (const m of text.matchAll(/<(dropTable|dropColumn|renameTable|renameColumn|modifyDataType|addNotNullConstraint|delete)\b[^>]*\/?>(?:[\s\S]*?<\/\1>)?/g)) {
      const [whole, tag = ""] = m
      if (tag === "addNotNullConstraint" && /\bdefaultNullValue=/.test(whole)) continue
      if (tag === "delete" && /<where>/.test(whole)) continue
      if (tag === "modifyDataType" && !BOUNDED.test(/newDataType="([^"]*)"/.exec(whole)?.[1] ?? "")) continue
      out.push(`${clip(whole.split(">")[0] + ">")}${tag.startsWith("rename") ? " (no view kept for the old name)" : ""}`)
    }
  } else {
    const blocks = text.split(/\n(?=\s*-\s*\w+:)/)
    for (const b of blocks) {
      const tag = /^\s*-\s*(dropTable|dropColumn|renameTable|renameColumn|modifyDataType|addNotNullConstraint|delete):/m.exec(b)?.[1]
      if (!tag) continue
      if (tag === "addNotNullConstraint" && /\bdefaultNullValue:/.test(b)) continue
      if (tag === "delete" && /\bwhere:/.test(b)) continue
      if (tag === "modifyDataType" && !BOUNDED.test(/newDataType:\s*(.+)/.exec(b)?.[1] ?? "")) continue
      const table = /tableName:\s*(\S+)/.exec(b)?.[1]
      out.push(`${tag}${table ? ` ${table}` : ""}${tag.startsWith("rename") ? " (no view kept for the old name)" : ""}`)
    }
  }
  return out
}

function findings(kind: Kind, text: string): string[] {
  if (kind === "sql") return sqlFindings(text)
  if (kind === "liquibase-xml" || kind === "liquibase-yaml") return liquibaseFindings(kind, text)
  return codeFindings(kind, text)
}

const current = (abs: string | undefined): string => {
  if (!abs) return ""
  try {
    return fs.readFileSync(abs, "utf8")
  } catch {
    return ""
  }
}

/** What an edit to a migration adds that destroys data or locks it out; undefined when it adds nothing of that. */
export function destructiveMigration(tool: string, input: Record<string, unknown>, absPath: string | undefined): MigrationFinding | undefined {
  const file = typeof input.file_path === "string" ? input.file_path : ""
  if (!file) return undefined
  let before = ""
  let after = ""
  if (tool === "Write") {
    after = typeof input.content === "string" ? input.content : ""
    before = current(absPath)
  } else if (tool === "Edit") {
    before = typeof input.old_string === "string" ? input.old_string : ""
    after = typeof input.new_string === "string" ? input.new_string : ""
  } else if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const edits = input.edits as Array<{ old_string?: unknown; new_string?: unknown }>
    before = edits.map((e) => (typeof e.old_string === "string" ? e.old_string : "")).join("\n")
    after = edits.map((e) => (typeof e.new_string === "string" ? e.new_string : "")).join("\n")
  } else return undefined
  const kind = migrationKind(file, `${current(absPath)}\n${after}`)
  if (!kind) return undefined
  const had = new Set(findings(kind, before))
  const added = [...new Set(findings(kind, after))].filter((s) => !had.has(s))
  if (!added.length) return undefined
  const shown = added.slice(0, 5).join("; ")
  return {
    ruleId: MIGRATION_RULE,
    reason: `This migration would destroy or lock out data: ${shown}${added.length > 5 ? `; and ${added.length - 5} more` : ""}. It waits for you.`,
    risk: MIGRATION_RISK,
  }
}
