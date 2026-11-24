// G34: language servers you name, for the file view. Off until named for a file ending; started without a shell in
// the session's folder; a file's problems, what is at the cursor and where a name is defined or used, with only places
// inside the folder passed on; a server that does not answer is stopped, and the next look starts it again.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Framer, frame, hoverText, LanguageServers, LspError, positionAt, serverFor, type LanguageServerSetting } from "../src/lsp-client.js"

let dir: string
let root: string
let server: string
beforeAll(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "g34-")))
  root = path.join(dir, "proj")
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, "app.py"), "import os\n\ndef greet(name):\n    return name\n\ngreet('x')\n")
  fs.writeFileSync(path.join(root, "lib.py"), "def helper():\n    pass\n")
  // A language server in a few lines: it answers initialize, publishes one problem on open, and answers hover,
  // definition (one place in the folder, one outside it) and references. "hang" in its arguments: it never answers hover.
  server = path.join(dir, "fake-ls.cjs")
  fs.writeFileSync(
    server,
    `const hang = process.argv.includes("hang")
const outside = ${JSON.stringify(pathToFileURL(path.join(dir, "elsewhere.py")).href)}
let buf = Buffer.alloc(0)
const send = (m) => { const b = JSON.stringify(m); process.stdout.write("Content-Length: " + Buffer.byteLength(b) + "\\r\\n\\r\\n" + b) }
require("fs").writeFileSync(require("path").join(process.cwd(), "started.txt"), JSON.stringify({ cwd: process.cwd(), key: process.env.ANTHROPIC_API_KEY ?? null }))
process.stdin.on("data", (c) => {
  buf = Buffer.concat([buf, c])
  for (;;) {
    const end = buf.indexOf("\\r\\n\\r\\n"); if (end < 0) return
    const len = Number(/Content-Length: (\\d+)/i.exec(buf.subarray(0, end).toString())[1])
    if (buf.length < end + 4 + len) return
    const m = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString()); buf = buf.subarray(end + 4 + len)
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { capabilities: {} } })
    else if (m.method === "textDocument/didOpen") {
      send({ jsonrpc: "2.0", id: 99, method: "workspace/configuration", params: { items: [] } })
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: m.params.textDocument.uri, diagnostics: [{ range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } }, message: "greet is called with a str", severity: 2 }] } })
    }
    else if (m.method === "textDocument/hover") { if (!hang) send({ jsonrpc: "2.0", id: m.id, result: { contents: { kind: "markdown", value: "\`\`\`python\\n(function) def greet(name) -> str\\n\`\`\`" }, pos: m.params.position } }) }
    else if (m.method === "textDocument/definition") send({ jsonrpc: "2.0", id: m.id, result: [{ uri: m.params.textDocument.uri, range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } } }, { uri: outside, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] })
    else if (m.method === "textDocument/references") send({ jsonrpc: "2.0", id: m.id, result: [{ uri: m.params.textDocument.uri, range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } } }] })
  }
})
`,
  )
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const setting = (args: string[] = []): LanguageServerSetting => ({ name: "fake", command: process.execPath, args: [server, ...args], extensions: ["py"] })

describe("language servers you name (G34)", () => {
  it("is off until a server is named for the file's ending", async () => {
    const off = new LanguageServers({ servers: () => undefined })
    expect(off.has("app.py")).toBe(false)
    await expect(off.ask("diagnostics", root, path.join(root, "app.py"), 0)).rejects.toThrow(LspError)
    off.close()
    expect(serverFor([setting()], "a.PY")?.name).toBe("fake")
    expect(serverFor([setting()], "a.go")).toBeUndefined()
    expect(serverFor([{ ...setting(), command: " " }], "a.py")).toBeUndefined()
  })

  it("gives a file's problems, what is at the cursor, and places inside the folder only, without a credential", async () => {
    const ls = new LanguageServers({ servers: () => [setting()], env: { ...process.env, ANTHROPIC_API_KEY: "should-not-pass" }, diagnosticsWaitMs: 2000 })
    try {
      const file = path.join(root, "app.py")
      expect(await ls.ask("diagnostics", root, file, 0)).toEqual([{ file: "app.py", line: 6, column: 1, text: "greet('x')", message: "greet is called with a str", severity: "warning" }])
      const text = fs.readFileSync(file, "utf8")
      expect(await ls.ask("info", root, file, text.indexOf("greet('x')") + 2)).toEqual({ text: "(function) def greet(name) -> str" })
      expect(await ls.ask("definition", root, file, text.indexOf("greet('x')"))).toEqual([{ file: "app.py", line: 3, column: 5, text: "def greet(name):" }])
      expect(await ls.ask("references", root, file, 0)).toEqual([{ file: "app.py", line: 6, column: 1, text: "greet('x')" }])
      const started = JSON.parse(fs.readFileSync(path.join(root, "started.txt"), "utf8")) as { cwd: string; key: string | null }
      expect(path.resolve(started.cwd)).toBe(root)
      expect(started.key).toBeNull()
    } finally {
      ls.close()
    }
  })

  it("stops a server that does not answer, and the next look starts it again", async () => {
    const which = { args: ["hang"] }
    const ls = new LanguageServers({ servers: () => [setting(which.args)], timeoutMs: 1500, diagnosticsWaitMs: 200 })
    try {
      const file = path.join(root, "lib.py")
      await expect(ls.ask("info", root, file, 0)).rejects.toThrow(/did not answer in time/)
      which.args = []
      expect(await ls.ask("info", root, file, 0)).toEqual({ text: "(function) def greet(name) -> str" })
    } finally {
      ls.close()
    }
  })
})

describe("the protocol's pieces (G34)", () => {
  it("frames and reads messages, in pieces too, and refuses an endless header", () => {
    const got: unknown[] = []
    const f = new Framer((m) => got.push(m))
    const both = Buffer.from(frame({ a: 1 }) + frame({ b: "é" }))
    f.push(both.subarray(0, 7))
    f.push(both.subarray(7, 30))
    f.push(both.subarray(30))
    expect(got).toEqual([{ a: 1 }, { b: "é" }])
    expect(() => new Framer(() => undefined).push(Buffer.alloc(70_000, 65))).toThrow(LspError)
    expect(() => new Framer(() => undefined, 10).push(Buffer.from("Content-Length: 99\r\n\r\n"))).toThrow(LspError)
  })

  it("turns an offset into a line and character, and a hover into plain text", () => {
    expect(positionAt("ab\ncde\nf", 5)).toEqual({ line: 1, character: 2 })
    expect(positionAt("ab", 99)).toEqual({ line: 0, character: 2 })
    expect(hoverText([{ value: "```go\nfunc X()\n```" }, "doc"])).toBe("func X()\ndoc")
    expect(hoverText(undefined)).toBe("")
  })
})
