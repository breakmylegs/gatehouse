/**
 * E-015, synthetic fixtures with a personal data scan (Expansion E3).
 *
 * Generating: seed rows made from the schema the project's migrations build (E-013's throwaway SQLite database), the
 * same rows for the same seed every time, with a small generator of Codehouse's own (no faker: a few lists and a seeded
 * random number are all it needs). Values look like their columns (an email column gets an address at example.com, a
 * phone column a number in Ofcom's drama range) and keep the schema's rules: NOT NULL, UNIQUE and primary keys, a
 * varchar's length, and foreign keys to rows made first. Each row is inserted into the throwaway database, so SQLite
 * itself checks them, CHECK constraints included; a row it refuses is made again with other values, a few times.
 *
 * Scanning: test data that looks like real people's: an email address at a domain that is not one of the reserved
 * example ones, a UK phone number outside Ofcom's drama ranges, a National Insurance number in the real format, and a
 * card number that passes the Luhn check and is not a documented test card. A finding names the file, line and kind,
 * with the value mostly masked.
 */
import { isRealCard, CARD_CANDIDATE } from "@gatehouse/policy"
import { dialectOf, OUTSIDE, sqliteEngine, type Migration, type SqliteEngine } from "./migration-rehearsal.js"

interface Col {
  name: string
  type: string
  notnull: boolean
  pk: boolean
  unique: boolean
  fk?: { table: string; column: string }
}

/** A seeded random number in [0, 1): mulberry32. */
export function seeded(seed: string): () => number {
  let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ["Ada", "Ben", "Cora", "Dev", "Esme", "Finn", "Gwen", "Hari", "Iris", "Jude", "Kit", "Lena"]
const LAST = ["Testwell", "Sampleton", "Fixture", "Placeholder", "Example", "Mockford", "Dummer", "Seedley"]
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]

function tableColumns(db: SqliteEngine, table: string): Col[] {
  const q = (s: string) => s.replace(/'/g, "''")
  const info = db.all(`SELECT name, type, "notnull" AS nn, pk FROM pragma_table_info('${q(table)}')`)
  const uniques = new Set<string>()
  for (const ix of db.all(`SELECT name, "unique" AS u FROM pragma_index_list('${q(table)}')`))
    if (Number(ix.u)) {
      const cols = db.all(`SELECT name FROM pragma_index_info('${q(String(ix.name))}')`)
      if (cols.length === 1) uniques.add(String(cols[0]!.name))
    }
  const fks = new Map(db.all(`SELECT "from" AS f, "table" AS t, "to" AS c FROM pragma_foreign_key_list('${q(table)}')`).map((r) => [String(r.f), { table: String(r.t), column: r.c ? String(r.c) : "" }]))
  return info.map((r) => ({
    name: String(r.name),
    type: String(r.type ?? "").toLowerCase(),
    notnull: Number(r.nn) === 1,
    pk: Number(r.pk) > 0,
    unique: uniques.has(String(r.name)),
    ...(fks.has(String(r.name)) ? { fk: fks.get(String(r.name))! } : {}),
  }))
}

/** Tables in an order where each comes after the tables it refers to. */
function ordered(db: SqliteEngine, tables: string[]): string[] {
  const out: string[] = []
  const visit = (t: string, path: Set<string>) => {
    if (out.includes(t) || path.has(t)) return
    path.add(t)
    for (const c of tableColumns(db, t)) if (c.fk && c.fk.table !== t && tables.includes(c.fk.table)) visit(c.fk.table, path)
    out.push(t)
  }
  for (const t of tables) visit(t, new Set())
  return out
}

/** A value for a column: its kind by its type and name, unique when it must be, within a varchar's length. */
function valueFor(c: Col, i: number, rnd: () => number, attempt: number, made: Map<string, unknown[]>): unknown {
  if (c.fk) {
    const keys = made.get(c.fk.table) ?? []
    return keys.length ? keys[Math.floor(rnd() * keys.length)] : c.notnull ? 1 : null
  }
  const n = i + 1 + attempt * 1000
  const name = c.name.toLowerCase()
  const max = Number(/\((\d+)\)/.exec(c.type)?.[1] ?? 0) || undefined
  // Cut to a varchar's length; a unique column too short for its value gets the row's number instead, so it stays unique.
  const fit = (s: string) => (!max || s.length <= max ? s : c.unique ? n.toString(36).slice(-max) : s.slice(0, max))
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!
  if (/int/.test(c.type) || (c.pk && !c.type)) return c.pk || c.unique ? n : Math.floor(rnd() * 1000)
  if (/bool/.test(c.type)) return rnd() < 0.5 ? 0 : 1
  if (/real|floa|doub|dec|num|money/.test(c.type)) return Math.round(rnd() * 10000) / 100
  if (/date|time/.test(c.type) || /(_at|_on|date)$/.test(name)) {
    const d = new Date(Date.UTC(2020, 0, 1) + Math.floor(rnd() * 1500) * 86_400_000 + (c.unique ? n * 1000 : 0))
    return /time|_at$/.test(c.type + name) ? d.toISOString() : d.toISOString().slice(0, 10)
  }
  if (/blob|binary/.test(c.type)) return null
  if (/e?mail/.test(name)) return fit(`user${n}@example.com`)
  if (/phone|mobile|tel/.test(name)) return fit(`07700 900${String(n % 1000).padStart(3, "0")}`)
  if (/first.?name|given/.test(name)) return fit(pick(FIRST))
  if (/last.?name|surname|family/.test(name)) return fit(pick(LAST))
  if (/name/.test(name)) return fit(`${pick(FIRST)} ${pick(LAST)}${c.unique ? ` ${n}` : ""}`)
  if (/url|link|website/.test(name)) return fit(`https://example.com/${n}`)
  if (/post.?code|zip/.test(name)) return fit("ZZ99 9ZZ")
  if (/uuid|guid/.test(name)) return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  return fit(`${pick(WORDS)}-${n}`)
}

export interface Generated {
  /** INSERT statements, table by table. */
  sql: string
  rows: Record<string, number>
  /** Rows SQLite would not take after several tries, with why. */
  refused: string[]
  notRun?: string
}

const literal = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

/** Seed rows for every table the migrations make, checked by inserting them into a throwaway database. */
export function generateFixtures(ms: Migration[], o: { rows?: number; seed?: string; tmp?: string } = {}): Generated {
  const empty = { sql: "", rows: {}, refused: [] }
  if (!ms.length) return { ...empty, notRun: "This project has no SQL migrations Codehouse recognises, so there is no schema to make rows for." }
  if (dialectOf(ms) !== "sqlite") return { ...empty, notRun: "These migrations are written for Postgres or SQL Server, so their rows are not checked here." }
  const outside = ms.find((m) => OUTSIDE.test(m.up))
  if (outside) return { ...empty, notRun: `${outside.name} attaches or writes another database file, or loads an extension, so it is not run here.` }
  const db = sqliteEngine(o.tmp)
  try {
    for (const m of ms) db.exec(m.up)
    db.exec("PRAGMA foreign_keys = ON")
    const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => String(r.name))
    const made = new Map<string, unknown[]>()
    const out: string[] = []
    const rows: Record<string, number> = {}
    const refused: string[] = []
    for (const t of ordered(db, tables)) {
      const cols = tableColumns(db, t)
      const key = cols.find((c) => c.pk) ?? cols[0]
      const rnd = seeded(`${o.seed ?? "codehouse"}:${t}`)
      rows[t] = 0
      for (let i = 0; i < (o.rows ?? 10); i++) {
        let last = ""
        for (let attempt = 0; attempt < 5; attempt++) {
          const values = cols.map((c) => valueFor(c, i, rnd, attempt, made))
          const stmt = `INSERT INTO "${t.replace(/"/g, '""')}" (${cols.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(", ")}) VALUES (${values.map(literal).join(", ")});`
          try {
            db.exec(stmt)
            out.push(stmt)
            rows[t]++
            if (key) made.set(t, [...(made.get(t) ?? []), values[cols.indexOf(key)]])
            last = ""
            break
          } catch (e) {
            last = String((e as Error).message).split("\n")[0]!
          }
        }
        if (last) refused.push(`${t} row ${i + 1}: ${last}`)
      }
    }
    return { sql: `${out.join("\n")}\n`, rows, refused }
  } catch (e) {
    return { ...empty, notRun: `The migrations could not be applied to a throwaway database: ${String((e as Error).message).split("\n")[0]}` }
  } finally {
    db.close()
  }
}

export type PiiKind = "email" | "uk-phone" | "ni-number" | "card"

export interface PiiFinding {
  file: string
  line: number
  kind: PiiKind
  /** The value, mostly masked. */
  sample: string
}

/** Domains kept for examples and tests (RFC 2606, RFC 6761), and so not real people's. */
const RESERVED = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost|local)$/i
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g
const UK_PHONE = /(?<![\d+])(?:\+44\s?\(?0?\)?\s?|0)(?:7\d{3}|1\d{3}|2\d|3\d{2}|8\d{2})[\s-]?\d{3}[\s-]?\d{3,4}(?!\d)/g
const NI = /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g

/** Ofcom's numbers for drama, which are never anyone's: 07700 900000 to 900999, 01632 960xxx, 020 7946 0xxx and the like. */
function dramaNumber(digits: string): boolean {
  const d = digits.replace(/^44/, "0")
  return /^07700900\d{3}$/.test(d) || /^01632960\d{3}$/.test(d) || /^0207946[0]\d{3}$/.test(d) || /^0(113|114|115|116|117|118|121|131|141|151|161|191)4960\d{3}$/.test(d) || /^0280180\d{4}$/.test(d) || /^0(29|23)20180\d{3}$/.test(d) || /^0(808|909)1570\d{3}$/.test(d) || /^03069990\d{3}$/.test(d)
}

const mask = (s: string) => (s.length <= 4 ? "****" : `${s.slice(0, 2)}${"*".repeat(Math.max(1, s.length - 4))}${s.slice(-2)}`)

/** Whether a path is test data: fixtures, seeds and test data folders and files. */
export const isFixture = (p: string) =>
  /(^|\/)(fixtures?|__fixtures__|seeds?|seed-data|testdata|test-data|test\/data|tests\/data|mocks?|__mocks__)\//i.test(p) || /(^|\/)[^/]*(fixture|seed)[^/]*\.(json|ya?ml|sql|csv|ts|js|py|cs|xml)$/i.test(p)

/** Real-looking personal data in a fixture's text, line by line. */
export function scanText(file: string, text: string): PiiFinding[] {
  const out: PiiFinding[] = []
  text.split(/\r?\n/).forEach((l, i) => {
    const line = i + 1
    for (const m of l.matchAll(EMAIL)) if (!RESERVED.test(m[1]!)) out.push({ file, line, kind: "email", sample: `${mask(m[0].split("@")[0]!)}@${m[1]}` })
    for (const m of l.matchAll(UK_PHONE)) if (!dramaNumber(m[0].replace(/\D/g, ""))) out.push({ file, line, kind: "uk-phone", sample: mask(m[0].replace(/\s/g, "")) })
    for (const m of l.matchAll(NI)) out.push({ file, line, kind: "ni-number", sample: mask(m[0].replace(/\s/g, "")) })
    for (const m of l.matchAll(new RegExp(CARD_CANDIDATE.source, "g"))) if (isRealCard(m[0])) out.push({ file, line, kind: "card", sample: `card ending ${m[0].replace(/\D/g, "").slice(-4)}` })
  })
  return out
}

/** The project's fixtures scanned, up to a limit of files and of bytes each. */
export function scanFixtures(paths: string[], read: (p: string) => string | undefined, limit = 500): PiiFinding[] {
  return paths
    .filter(isFixture)
    .slice(0, limit)
    .flatMap((p) => {
      const text = read(p)
      return text && text.length < 2_000_000 && !text.includes("\0") ? scanText(p, text) : []
    })
}
