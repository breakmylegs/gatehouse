// E-015: generated seed rows keep the schema's rules and are the same for the same seed; real-looking personal data in
// fixtures is flagged, and reserved example data is not.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { generateFixtures, isFixture, scanFixtures, scanText, seeded } from "../src/fixtures.js"
import type { Migration } from "../src/migration-rehearsal.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-fixtures-test-"))
  dirs.push(d)
  return d
}

const ms: Migration[] = [
  {
    name: "001",
    up: `CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(40) NOT NULL UNIQUE, full_name VARCHAR(12) NOT NULL, phone TEXT, age INTEGER CHECK (age >= 0), created_at TIMESTAMP NOT NULL);
         CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), total DECIMAL(8,2) NOT NULL CHECK (total >= 0), code VARCHAR(6) UNIQUE);`,
  },
]

/** A number that passes the Luhn check, made here so no card-like number is written in the repository. */
function luhn(body: string): string {
  const sum = [...body].reverse().reduce((s, ch, i) => {
    let d = Number(ch)
    if (i % 2 === 0) d *= 2
    return s + (d > 9 ? d - 9 : d)
  }, 0)
  return body + String((10 - (sum % 10)) % 10)
}

describe("synthetic fixtures", () => {
  it("makes rows that keep the schema's rules, foreign keys to rows made first, and deletes its database", () => {
    const dir = tmp()
    const g = generateFixtures(ms, { rows: 25, tmp: dir })
    expect(g.notRun).toBeUndefined()
    expect(g.refused).toEqual([])
    expect(g.rows).toEqual({ orders: 25, users: 25 })
    expect(fs.readdirSync(dir)).toEqual([])
    // A fresh database with the same schema and its rules switched on takes every row.
    const db = new DatabaseSync(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    db.exec(ms[0]!.up)
    db.exec(g.sql)
    const users = db.prepare("SELECT email, full_name, phone FROM users").all() as Array<{ email: string; full_name: string; phone: string }>
    expect(users).toHaveLength(25)
    expect(new Set(users.map((u) => u.email)).size).toBe(25)
    expect(users.every((u) => u.email.endsWith("@example.com") && u.email.length <= 40 && u.full_name.length <= 12)).toBe(true)
    expect(scanText("seed.sql", g.sql)).toEqual([])
    expect((db.prepare("SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id").get() as { n: number }).n).toBe(25)
    db.close()
  })

  it("is the same for the same seed, and different for another", () => {
    expect(generateFixtures(ms, { seed: "a", tmp: tmp() }).sql).toBe(generateFixtures(ms, { seed: "a", tmp: tmp() }).sql)
    expect(generateFixtures(ms, { seed: "a", tmp: tmp() }).sql).not.toBe(generateFixtures(ms, { seed: "b", tmp: tmp() }).sql)
    const r = seeded("x")
    expect([r(), r()]).toEqual([seeded("x")(), (() => { const s = seeded("x"); s(); return s() })()])
  })

  it("makes a row again when SQLite refuses it, and says so when it cannot", () => {
    const g = generateFixtures([{ name: "1", up: "CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER CHECK (n < 0));" }], { rows: 2, tmp: tmp() })
    expect(g.refused).toEqual([expect.stringMatching(/^t row 1: CHECK constraint failed/), expect.stringMatching(/^t row 2: /)])
    // About half the values fail this check, so every row goes in only because refused rows are made again.
    const half = generateFixtures([{ name: "1", up: "CREATE TABLE s (id INTEGER PRIMARY KEY, score INTEGER NOT NULL CHECK (score < 500));" }], { rows: 12, tmp: tmp() })
    expect(half).toMatchObject({ rows: { s: 12 }, refused: [] })
    expect(generateFixtures([]).notRun).toMatch(/no SQL migrations/)
    expect(generateFixtures([{ name: "1", up: "CREATE TABLE t (id bigserial);" }]).notRun).toMatch(/Postgres or SQL Server/)
  })
})

describe("the personal data scan", () => {
  it("flags a real-looking email, UK phone, National Insurance number and card, masked", () => {
    const card = luhn("453201511283036")
    const text = [`{"email": "jane.doe@gmail.com", "ok": "a@example.com", "t": "x@test"}`, `phone: 07911 123456, drama: 07700 900123`, `ni: AB 12 34 56 C, not: QQ123456C`, `card: ${card}, test: 4242424242424242`].join("\n")
    expect(scanText("fixtures/users.json", text)).toEqual([
      { file: "fixtures/users.json", line: 1, kind: "email", sample: "ja****oe@gmail.com" },
      { file: "fixtures/users.json", line: 2, kind: "uk-phone", sample: "07*******56" },
      { file: "fixtures/users.json", line: 3, kind: "ni-number", sample: "AB*****6C" },
      { file: "fixtures/users.json", line: 4, kind: "card", sample: `card ending ${card.slice(-4)}` },
    ])
  })

  it("scans only test data", () => {
    expect(isFixture("test/fixtures/a.json")).toBe(true)
    expect(isFixture("db/seeds/users.sql")).toBe(true)
    expect(isFixture("src/user.seed.ts")).toBe(true)
    expect(isFixture("src/app.ts")).toBe(false)
    const files: Record<string, string> = { "test/fixtures/a.json": "bob@hotmail.co.uk", "src/app.ts": "bob@hotmail.co.uk" }
    expect(scanFixtures(Object.keys(files), (p) => files[p]).map((f) => f.file)).toEqual(["test/fixtures/a.json"])
  })
})
