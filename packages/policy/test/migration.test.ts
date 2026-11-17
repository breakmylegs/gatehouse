// E-011: an edit to a database migration that destroys or locks out data waits for you, showing the statements; the
// migration tools are found by place and words, what the file already had is not found again, and safe changes pass.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { MIGRATION_RISK, MIGRATION_RULE, destructiveMigration, migrationKind } from "../src/migration.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-mig-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const write = (file: string, content: string) => destructiveMigration("Write", { file_path: path.join(dir, file), content }, path.join(dir, file))

describe("destructive migrations (E-011)", () => {
  it("holds each destructive SQL statement, showing it", () => {
    for (const [sql, shown] of [
      ["DROP TABLE orders;", "DROP TABLE orders"],
      ["ALTER TABLE users DROP COLUMN email;", "ALTER TABLE users DROP COLUMN email"],
      ["TRUNCATE TABLE audit;", "TRUNCATE TABLE audit"],
      ["DELETE FROM sessions;", "DELETE FROM sessions (no WHERE)"],
      ["ALTER TABLE users ADD COLUMN tier text NOT NULL;", "(NOT NULL with no default)"],
      ["ALTER TABLE users ALTER COLUMN name SET NOT NULL;", "(NOT NULL on rows that may have none)"],
      ["ALTER TABLE users ALTER COLUMN name TYPE varchar(20);", "(a type change that may narrow)"],
      ["ALTER TABLE users RENAME COLUMN name TO full_name;", "(no view kept for the old name)"],
      ["EXEC sp_rename 'users.name', 'full_name', 'COLUMN';", "(no view kept for the old name)"],
    ]) {
      const r = write("migrations/002_change.sql", `-- change\n${sql}\n`)
      expect(r, sql).toMatchObject({ ruleId: MIGRATION_RULE, risk: MIGRATION_RISK })
      expect(r?.reason, sql).toContain(shown)
    }
  })

  it("leaves safe SQL be: a WHERE, a default, a new table, a rename with a view, a widening, a dropped default", () => {
    for (const sql of [
      "DELETE FROM sessions WHERE expires < now();",
      "ALTER TABLE users ADD COLUMN tier text NOT NULL DEFAULT 'free';",
      "CREATE TABLE tiers (id int NOT NULL);",
      "ALTER TABLE users RENAME TO people; CREATE VIEW users AS SELECT * FROM people;",
      "ALTER TABLE users ALTER COLUMN id TYPE bigint;",
      "ALTER TABLE users ALTER COLUMN tier DROP NOT NULL; ALTER TABLE users ALTER COLUMN tier DROP DEFAULT;",
      "-- DROP TABLE orders;\nSELECT 1;",
    ])
      expect(write("migrations/003_safe.sql", sql), sql).toBeUndefined()
  })

  it("finds each tool's migrations by place and words, and nothing else", () => {
    expect(migrationKind("prisma/migrations/20261117_x/migration.sql", "")).toBe("sql")
    expect(migrationKind("src/main/resources/db/V3__drop.sql", "")).toBe("sql")
    expect(migrationKind("scripts/report.sql", "DROP TABLE x;")).toBeUndefined()
    expect(migrationKind("db/changelog.xml", "<databaseChangeLog>")).toBe("liquibase-xml")
    expect(migrationKind("db/changelog.yaml", "databaseChangeLog:\n")).toBe("liquibase-yaml")
    expect(migrationKind("Migrations/2026_Init.cs", "migrationBuilder.CreateTable(")).toBe("ef")
    expect(migrationKind("alembic/versions/ab12_x.py", "def upgrade():\n")).toBe("alembic")
    expect(migrationKind("migrations/2026_x.js", "exports.up = function (knex) {}")).toBe("knex")
    expect(migrationKind("src/app.ts", "knex.schema.dropTable('x')")).toBeUndefined()
  })

  it("holds the ORM calls that destroy data, and leaves their safe forms be", () => {
    expect(write("Migrations/1_Drop.cs", `migrationBuilder.DropColumn(name: "Email", table: "Users");`)?.reason).toContain("DropColumn")
    expect(write("Migrations/2_Add.cs", `migrationBuilder.AddColumn<int>(name: "Tier", table: "Users", nullable: false);`)?.reason).toContain("NOT NULL with no default")
    expect(write("Migrations/3_Add.cs", `migrationBuilder.AddColumn<int>(name: "Tier", table: "Users", nullable: false, defaultValue: 0);`)).toBeUndefined()
    expect(write("Migrations/4_Sql.cs", `migrationBuilder.Sql(@"TRUNCATE TABLE Logs");`)?.reason).toContain("TRUNCATE TABLE Logs")
    expect(write("alembic/versions/a1.py", "def upgrade():\n    op.drop_table('orders')\n")?.reason).toContain("op.drop_table('orders')")
    expect(write("alembic/versions/a2.py", "def upgrade():\n    op.add_column('u', sa.Column('t', sa.Text(), nullable=False))\n")?.reason).toContain("NOT NULL")
    expect(write("alembic/versions/a3.py", "def upgrade():\n    op.add_column('u', sa.Column('t', sa.Text(), nullable=False, server_default='x'))\n")).toBeUndefined()
    expect(write("migrations/k1.js", "exports.up = (knex) => knex.schema.alterTable('u', (t) => {\n  t.string('tier').notNullable()\n})")?.reason).toContain("NOT NULL")
    expect(write("migrations/k2.js", "exports.up = (knex) => knex.schema.createTable('u', (t) => {\n  t.string('tier').notNullable()\n})")).toBeUndefined()
    expect(write("migrations/k3.js", "exports.up = (knex) => knex('sessions').del();")?.reason).toContain("no WHERE")
    expect(write("migrations/k4.js", "exports.up = (knex) => knex('sessions')\n  .where('old', true)\n  .del();")).toBeUndefined()
    expect(write("db/changelog.xml", `<databaseChangeLog><changeSet id="1"><dropTable tableName="orders"/></changeSet></databaseChangeLog>`)?.reason).toContain("dropTable")
    expect(write("db/changelog.yaml", "databaseChangeLog:\n  - changeSet:\n      changes:\n        - dropColumn:\n            tableName: users\n")?.reason).toContain("dropColumn users")
  })

  it("does not find again what the file had, and reads an Edit's new text", () => {
    const file = path.join(dir, "migrations", "004_had.sql")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "DROP TABLE legacy;\n")
    expect(destructiveMigration("Write", { file_path: file, content: "DROP TABLE legacy;\nCREATE TABLE x (id int);\n" }, file)).toBeUndefined()
    expect(destructiveMigration("Edit", { file_path: file, old_string: "DROP TABLE legacy;", new_string: "DROP TABLE legacy;\nTRUNCATE orders;" }, file)?.reason).toContain("TRUNCATE orders")
    expect(destructiveMigration("MultiEdit", { file_path: file, edits: [{ old_string: "DROP TABLE legacy;", new_string: "DELETE FROM legacy;" }] }, file)?.reason).toContain("no WHERE")
    expect(destructiveMigration("Read", { file_path: file }, file)).toBeUndefined()
  })
})
