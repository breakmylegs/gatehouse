// E-014: the queries a change adds, explained in a database built from the migrations; an unindexed query reports a
// scan and suggests an index.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Migration } from "../src/migration-rehearsal.js"
import { explainAll, placeholders, queriesIn } from "../src/query-plan.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-plan-test-"))
  dirs.push(d)
  return d
}

const ms: Migration[] = [
  { name: "001", up: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);", down: "DROP TABLE users;" },
  { name: "002", up: "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL); CREATE INDEX orders_user ON orders (user_id);" },
]

describe("query plan review", () => {
  it("finds the queries a change adds in TypeScript, Python and C#, interpolations as placeholders", async () => {
    const ts = 'const a = db.all(`SELECT * FROM users WHERE email = ${email}`)\nconst b = "SELECT id FROM orders WHERE user_id = ?"\nconst c = "not a query"\n'
    expect(await queriesIn("src/a.ts", ts)).toEqual([
      { file: "src/a.ts", line: 1, sql: "SELECT * FROM users WHERE email = ?" },
      { file: "src/a.ts", line: 2, sql: "SELECT id FROM orders WHERE user_id = ?" },
    ])
    expect((await queriesIn("src/a.ts", ts, new Set([2]))).map((q) => q.line)).toEqual([2])
    expect((await queriesIn("app/db.py", 'cur.execute("""\n  SELECT * FROM users\n  WHERE name = %s""", (n,))\n')).map((q) => [q.line, q.sql])).toEqual([[1, "SELECT * FROM users\n  WHERE name = %s"]])
    expect((await queriesIn("Data/Repo.cs", 'var q = $"SELECT * FROM users WHERE id = {id}"; var r = @"DELETE FROM orders";')).map((q) => q.sql)).toEqual(["SELECT * FROM users WHERE id = ?", "DELETE FROM orders"])
    expect(await queriesIn("README.md", "SELECT 1")).toEqual([])
  })

  it("reports a scan of an unindexed query and suggests an index, and leaves an indexed one alone", () => {
    const dir = tmp()
    const r = explainAll(ms, [
      { file: "a.ts", line: 1, sql: "SELECT * FROM users WHERE email = $1 AND name LIKE :n ORDER BY name" },
      { file: "a.ts", line: 2, sql: "SELECT total FROM orders WHERE user_id = %s" },
    ], dir)
    expect(r.notRun).toBeUndefined()
    expect(r.findings[0]).toMatchObject({ scans: ["users"], suggest: ["CREATE INDEX users_email_name ON users (email, name);"], sort: true })
    expect(r.findings[1]).toMatchObject({ scans: [], suggest: [] })
    expect(r.findings[1]!.plan.join(" ")).toMatch(/SEARCH orders USING INDEX orders_user/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("explains nothing that is more than one statement or reaches outside the database, and says why it could not run", () => {
    const dir = tmp()
    const r = explainAll(ms, [
      { file: "a.ts", line: 1, sql: "SELECT 1; DROP TABLE users" },
      { file: "a.ts", line: 2, sql: "SELECT * FROM nowhere" },
    ], dir)
    expect(r.findings[0]!.error).toMatch(/more than one statement/)
    expect(r.findings[1]!.error).toMatch(/no such table: nowhere/)
    expect(explainAll([], [{ file: "a", line: 1, sql: "SELECT 1" }]).notRun).toMatch(/no SQL migrations/)
    expect(explainAll([{ name: "1", up: "CREATE TABLE t (id bigserial);" }], [{ file: "a", line: 1, sql: "SELECT 1" }]).notRun).toMatch(/Postgres or SQL Server/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("reads placeholders of the common drivers", () => {
    expect(placeholders("a = $1 AND b = :name AND c = @p AND d = %s AND e = %(x)s AND f = '10:30' AND g::text = ?")).toBe("a = ? AND b = ? AND c = ? AND d = ? AND e = ? AND f = '10:30' AND g::text = ?")
  })
})
