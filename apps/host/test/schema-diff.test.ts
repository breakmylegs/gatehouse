// E-012: the schema before and after a change, from migrations, DDL, Prisma or an EF Core snapshot, drawn as an ER diff
// with an added column shown as added and a dropped one as removed.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { applySql, diffSchemas, efSnapshot, erDiff, prismaSchema, projectSchemaDiff, schemaFiles, type Schema } from "../src/schema-diff.js"

const sql = (...texts: string[]) => texts.reduce<Schema>((s, t) => applySql(s, t), new Map())
const cols = (s: Schema, t: string) => Object.fromEntries(s.get(t) ?? [])

describe("the schema diff view", () => {
  it("reads SQL in order: create, add, drop, rename and retype columns, and drop or rename tables", () => {
    const s = sql(
      `-- who signs in
       CREATE TABLE "users" (id serial PRIMARY KEY, email varchar(200) NOT NULL, name text, CONSTRAINT u UNIQUE (email));
       CREATE TABLE IF NOT EXISTS public.audit (id int, at timestamp with time zone DEFAULT now());`,
      `ALTER TABLE users ADD COLUMN age integer NOT NULL DEFAULT 0, DROP COLUMN name;
       -- DROP TABLE users;
       ALTER TABLE users RENAME COLUMN email TO mail; ALTER TABLE users ALTER COLUMN age TYPE bigint;
       ALTER TABLE users ALTER COLUMN mail SET NOT NULL; ALTER TABLE audit RENAME TO audits; CREATE TABLE gone (x int); DROP TABLE gone;`,
    )
    expect(cols(s, "users")).toEqual({ id: "serial", mail: "varchar(200)", age: "bigint" })
    expect(cols(s, "audits")).toEqual({ id: "int", at: "timestamp with time zone" })
    expect([...s.keys()].sort()).toEqual(["audits", "users"])
  })

  it("shows an added column as added and a dropped column as removed, in an ER diagram of the changed tables only", () => {
    const before = sql("CREATE TABLE users (id int, name text); CREATE TABLE posts (id int); CREATE TABLE old (id int);")
    const after = sql("CREATE TABLE users (id bigint, email text); CREATE TABLE posts (id int); CREATE TABLE tags (id int, label text);")
    const d = diffSchemas(before, after)
    expect(d.map((t) => [t.table, t.state])).toEqual([["old", "removed"], ["tags", "added"], ["users", "changed"]])
    const er = erDiff(d)
    expect(er).toMatch(/^erDiagram\n/)
    expect(er).toContain('    text email "added"')
    expect(er).toContain('    text name "removed"')
    expect(er).toContain('    bigint id "changed from int"')
    expect(er).toContain('    text label "added"')
    expect(er).not.toContain("posts")
  })

  it("keeps the diagram's text to names Mermaid reads, whatever the schema says", () => {
    const er = erDiff(diffSchemas(new Map(), new Map([['we"ird %%{init}', new Map([['c" {', 'varchar(10) "x"']])]])))
    expect(er).not.toMatch(/%%|\{init|"x"/)
    expect(er).toContain('    varchar_10___x_ c___ "added"')
  })

  it("reads a Prisma schema and an EF Core snapshot", () => {
    const p = prismaSchema(`model User {\n  id    Int     @id\n  email String? @map("mail")\n  posts Post[]\n  team  Team    @relation(fields: [teamId], references: [id])\n  teamId Int\n  @@map("users")\n}\n`)
    expect(cols(p, "users")).toEqual({ id: "int", mail: "string?", teamId: "int" })
    const ef = efSnapshot(`modelBuilder.Entity("Shop.Models.Blog", b =>\n{\n b.Property<int>("Id")\n .ValueGeneratedOnAdd();\n b.Property<string>("Url")\n .HasMaxLength(200);\n b.HasKey("Id");\n b.ToTable("Blogs");\n});\nmodelBuilder.Entity("Shop.Models.Post", b =>\n{\n b.Property<int?>("BlogId");\n b.HasOne("Shop.Models.Blog", null)\n .WithMany();\n});`)
    expect(cols(ef, "Blogs")).toEqual({ Id: "int", Url: "string" })
    expect(cols(ef, "Post")).toEqual({ BlogId: "int?" })
  })

  it("finds where a project keeps its schema", () => {
    expect(schemaFiles(["prisma/schema.prisma", "db/migrations/1.sql"], () => "")?.source).toBe("prisma")
    expect(schemaFiles(["Data/Migrations/AppDbContextModelSnapshot.cs"], () => "")?.source).toBe("ef")
    expect(schemaFiles(["db/migrations/002_b.sql", "db/migrations/001_a.sql", "src/x.sql"], () => "")).toEqual({ source: "migrations", files: ["db/migrations/001_a.sql", "db/migrations/002_b.sql"] })
    expect(schemaFiles(["sql/schema.sql"], () => "create table t (id int)")?.source).toBe("ddl")
    expect(schemaFiles(["src/report.sql"], () => "select 1")).toBeUndefined()
  })

  it("compares a project's last commit with its working folder", { timeout: 30_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-schema-"))
    try {
      const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir, stdio: "ignore" })
      g("init", "-q")
      fs.mkdirSync(path.join(dir, "migrations"))
      fs.writeFileSync(path.join(dir, "migrations", "001_users.sql"), "CREATE TABLE users (id int, nickname text);")
      g("add", "-A")
      g("commit", "-qm", "one")
      fs.writeFileSync(path.join(dir, "migrations", "002_email.sql"), "ALTER TABLE users ADD COLUMN email text; ALTER TABLE users DROP COLUMN nickname;")
      const r = await projectSchemaDiff(dir, (p) => fs.readFileSync(path.join(dir, p), "utf8"))
      expect(r?.source).toBe("migrations")
      expect(r?.summary).toEqual(["users: email added, nickname removed"])
      expect(r?.mermaid).toContain('text email "added"')
      expect(r?.mermaid).toContain('text nickname "removed"')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
