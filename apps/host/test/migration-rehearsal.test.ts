// E-013: migrations run up, down and up again against a throwaway database; one with no down step is reported as
// irreversible, and the database is deleted afterwards.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { dialectOf, findMigrations, postgresScript, readPostgresOutput, rehearse, splitMarked, type Migration } from "../src/migration-rehearsal.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-rehearse-test-"))
  dirs.push(d)
  return d
}

const users: Migration = { name: "001_users", up: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);", down: "DROP TABLE users;" }

describe("migration rehearsal", () => {
  it("runs each migration up and down on SQLite, reports one with no down step as irreversible, and deletes the database", async () => {
    const dir = tmp()
    const r = await rehearse([users, { name: "002_age", up: "ALTER TABLE users ADD COLUMN age INTEGER;" }], { tmp: dir })
    expect(r.engine).toBe("sqlite")
    expect(r.steps).toEqual([
      { name: "001_users", up: "ok", down: "ok", restores: true },
      { name: "002_age", up: "ok", down: "missing" },
    ])
    expect(r.irreversible).toEqual(["002_age"])
    expect(r.failures).toEqual([])
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("reports a down step that leaves the schema different, and a failing step with its error", async () => {
    const dir = tmp()
    const r = await rehearse(
      [users, { name: "002_idx", up: "CREATE INDEX users_email ON users (email);", down: "SELECT 1;" }, { name: "003_bad", up: "ALTER TABLE nowhere ADD COLUMN x INTEGER;", down: "SELECT 1;" }],
      { tmp: dir },
    )
    expect(r.steps[1]).toMatchObject({ name: "002_idx", down: "ok", restores: false })
    expect(r.irreversible).toEqual(["002_idx"])
    expect(r.failures).toEqual([expect.stringMatching(/^003_bad: up: .*no such table: nowhere/)])
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("runs nothing that could write a file outside the throwaway database", async () => {
    const dir = tmp()
    const target = path.join(dir, "outside.db")
    for (const up of [`ATTACH DATABASE '${target}' AS x; CREATE TABLE x.t (id INTEGER);`, `CREATE TABLE t (id INTEGER); VACUUM INTO '${target}';`, "SELECT load_extension('evil');"]) {
      const r = await rehearse([users, { name: "002_out", up }], { tmp: dir })
      expect(r).toMatchObject({ engine: "none", steps: [], notRun: expect.stringMatching(/^002_out attaches or writes another database file/) })
    }
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("finds migrations by convention, in version order", () => {
    const files: Record<string, string> = {
      "db/migrations/10_tags.up.sql": "CREATE TABLE tags (id INTEGER);",
      "db/migrations/10_tags.down.sql": "DROP TABLE tags;",
      "db/migrations/2_users.up.sql": "CREATE TABLE users (id INTEGER);",
      "sql/V1_1__init.sql": "CREATE TABLE a (id INTEGER);",
      "sql/U1_1__init.sql": "DROP TABLE a;",
      "migrations/003_goose.sql": "-- +goose Up\nCREATE TABLE g (id INTEGER);\n-- +goose Down\nDROP TABLE g;\n",
      "prisma/migrations/20261101_init/migration.sql": "CREATE TABLE p (id INTEGER);",
      "src/report.sql": "SELECT 1;",
    }
    const ms = findMigrations(Object.keys(files), (p) => files[p]!)
    expect(ms.map((m) => [m.name, m.down !== undefined])).toEqual([
      ["V1_1__init", true],
      ["2_users", false],
      ["003_goose", true],
      ["10_tags", true],
      ["20261101_init", false],
    ])
    expect(splitMarked("-- migrate:up\nA;\n-- migrate:down\nB;\n")).toEqual({ up: "\nA;\n", down: "\nB;\n" })
  })

  it("leaves Postgres to a container and SQL Server alone, saying why", async () => {
    const pg: Migration = { name: "1", up: "CREATE TABLE t (id bigserial, doc jsonb);", down: "DROP TABLE t;" }
    expect(dialectOf([pg])).toBe("postgres")
    expect(dialectOf([{ name: "1", up: "CREATE TABLE [dbo].[t] (id INT IDENTITY(1,1), n NVARCHAR(10));" }])).toBe("sqlserver")
    expect((await rehearse([pg])).notRun).toMatch(/Postgres\. Switch container runs on/)
    const seen: Migration[][] = []
    const out = "@@SCHEMA 0 before aaa\n@@OK 0 up\n@@OK 0 down\n@@SCHEMA 0 after aaa\n@@DONE\n"
    const r = await rehearse([pg], { container: { exe: "podman", image: "i", scratch: "s" }, postgres: async (_c, ms) => (seen.push(ms), out) })
    expect(seen).toHaveLength(1)
    expect(r).toMatchObject({ engine: "postgres", steps: [{ name: "1", up: "ok", down: "ok", restores: true }], irreversible: [] })
  })

  it("writes the container script with each step marked, and reads failures and changed schemas back", () => {
    const { script, files } = postgresScript([users, { name: "2", up: "ALTER TABLE users ADD c int;" }])
    expect(script).toContain("@@OK 0 up")
    expect(script).toContain("run /m/0.down.sql")
    expect(script).not.toContain("1.down.sql")
    expect(Object.keys(files)).toEqual(["0.up.sql", "0.down.sql", "1.up.sql"])
    const r = readPostgresOutput("@@SCHEMA 0 before aaa\n@@OK 0 up\n@@OK 0 down\n@@SCHEMA 0 after bbb\n@@SCHEMA 1 before ccc\n@@FAIL 1 up ERROR: relation does not exist\n", [users, { name: "2", up: "x" }])
    expect(r.steps).toEqual([
      { name: "001_users", up: "ok", down: "ok", restores: false },
      { name: "2", up: "failed", down: "missing", error: "up ERROR: relation does not exist" },
    ])
    expect(readPostgresOutput("@@FAIL setup initdb\n", [users]).failures).toEqual(["the database could not be made in the container (initdb)"])
  })
})
