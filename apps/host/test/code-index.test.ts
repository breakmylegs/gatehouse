// C-036: the local codebase index: text and symbols, incremental, under the data folder, and never anything the floor
// keeps out (secrets), version control, dependencies, binaries or large files.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { compileGlobs } from "@gatehouse/policy"
import { CodeIndex, ftsQuery, MAX_FILE, symbolsOf } from "../src/code-index.js"

let root: string
let data: string
const open: CodeIndex[] = []
const write = (rel: string, text: string | Buffer) => {
  const p = path.join(root, ...rel.split("/"))
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}
// The floor's secret globs, as policy/rules.yaml gives them for Read (a few of them).
const blocked = compileGlobs(["**/.env", "**/.env.*", "**/*.pem", "**/id_rsa*"])
const index = () => {
  const i = new CodeIndex({ dir: data, root, blocked })
  open.push(i)
  return i
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-idx-root-"))
  data = fs.mkdtempSync(path.join(os.tmpdir(), "gh-idx-data-"))
  write("src/login.ts", "export function signIn(user: string) {\n  return checkPassword(user)\n}\nexport class SessionStore {}\n")
  write("src/util.py", "def parse_header(line):\n    return line\nclass Reader:\n    pass\n")
  write(".env", "API_TOKEN=supersecretvalue123\n")
  write("keys/server.pem", "only its name matters here supersecretvalue123")
  write("node_modules/lib/index.js", "export function dependencyThing() {}\n")
  write(".git/config", "repositoryformatversion\n")
  write("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]))
  write("big.txt", "x".repeat(MAX_FILE + 1))
})
afterEach(() => {
  for (const i of open.splice(0)) i.close()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
})

describe("the codebase index (C-036)", () => {
  it("finds words and symbols, and holds nothing the floor keeps out", async () => {
    const i = index()
    const s = await i.refresh()
    // Looked at: the two sources and the picture (read, found binary, left out). Left out: .env, the key, the picture
    // and the large file; node_modules and .git are never walked at all.
    expect(s).toMatchObject({ files: 3, indexed: 2, removed: 0, skipped: 4 })
    expect(i.search("checkPassword").map((r) => r.path)).toEqual(["src/login.ts"])
    expect(i.search("checkPassword")[0]!.snippet).toContain("[checkPassword]")
    expect(i.search("supersecretvalue123")).toEqual([])
    expect(i.search("dependencyThing")).toEqual([])
    expect(i.search("repositoryformatversion")).toEqual([])
    expect(i.symbols("sign").map((x) => [x.path, x.name, x.kind, x.line])).toEqual([["src/login.ts", "signIn", "function", 1]])
    expect(i.symbols("parse_").map((x) => x.name)).toEqual(["parse_header"])
    expect(i.symbols("sessionst").map((x) => x.name)).toEqual(["SessionStore"])
    // Under the data folder, not the project.
    expect(fs.readdirSync(data).some((f) => f.endsWith(".sqlite"))).toBe(true)
    expect(fs.readdirSync(root).some((f) => f.endsWith(".sqlite"))).toBe(false)
  })

  it("reads again only what changed, and drops what is gone", async () => {
    const i = index()
    await i.refresh()
    expect(await i.refresh()).toMatchObject({ indexed: 0, removed: 0 })
    write("src/login.ts", "export function signOut() {}\n")
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(path.join(root, "src", "login.ts"), later, later)
    fs.rmSync(path.join(root, "src", "util.py"))
    expect(await i.refresh()).toMatchObject({ indexed: 1, removed: 1 })
    expect(i.search("checkPassword")).toEqual([])
    expect(i.symbols("sign").map((x) => x.name)).toEqual(["signOut"])
    expect(i.symbols("parse_")).toEqual([])
    // A second index on the same data folder reads what the first kept.
    i.close()
    open.splice(open.indexOf(i), 1)
    expect(await index().refresh()).toMatchObject({ indexed: 0 })
  })

  it("never reads what is typed as FTS syntax", () => {
    expect(ftsQuery('foo" OR bar NEAR(x')).toBe('"foo" "OR" "bar" "NEAR" "x"')
    expect(ftsQuery("*:^")).toBeUndefined()
    expect(symbolsOf("a.cs", "public sealed class Thing {\n  public async Task<int> Run(int x) {")).toEqual([
      { name: "Thing", kind: "class", line: 1 },
      { name: "Run", kind: "function", line: 2 },
    ])
  })
})
