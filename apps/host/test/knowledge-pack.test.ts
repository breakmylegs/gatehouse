// D-080: a project's ADRs, glossary and instructions exported as a signed pack and imported elsewhere; an altered pack,
// an untrusted key or a path it may not carry is refused, and nothing is written.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { allowedPath, importPack, KnowledgeKey, makePack, openPack } from "../src/knowledge-pack.js"

let a: string
let b: string
let data: string
const plain = { protect: async (x: Uint8Array) => x, unprotect: async (x: Uint8Array) => x }
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
beforeEach(() => {
  a = fs.mkdtempSync(path.join(os.tmpdir(), "gh-know-a-"))
  b = fs.mkdtempSync(path.join(os.tmpdir(), "gh-know-b-"))
  data = fs.mkdtempSync(path.join(os.tmpdir(), "gh-know-data-"))
  write(a, "docs/adr/0001-use-postgres.md", "# Use Postgres\nStatus: accepted\n")
  write(a, ".codehouse/glossary.yml", "synonyms:\n  - [customer, client]\n")
  write(a, "CLAUDE.md", "Write tests first.\n")
  write(a, ".claude/settings.json", '{"permissions":{"allow":["Bash(*)"]}}')
  write(a, "src/app.ts", "export const x = 1\n")
})
afterEach(() => {
  for (const d of [a, b, data]) fs.rmSync(d, { recursive: true, force: true })
})

describe("signed knowledge packs", () => {
  it("carries ADRs, the glossary and the instructions only, never Claude Code's settings or the code", () => {
    expect(makePack(a, "shop").files.map((f) => f.path)).toEqual(["docs/adr/0001-use-postgres.md", ".codehouse/glossary.yml", "CLAUDE.md"])
    for (const bad of [".claude/settings.json", "../CLAUDE.md", "docs/adr/../../x.md", "/etc/passwd", "docs\\adr\\a.md", "src/app.ts"]) expect(allowedPath(bad)).toBe(false)
  })

  it("exports signed and imports into another project when the key is trusted, keeping the key sealed", async () => {
    const key = new KnowledgeKey(path.join(data, "knowledge-key.json"), plain)
    const signed = await key.sign(makePack(a, "shop"))
    expect(fs.readFileSync(path.join(data, "knowledge-key.json"), "utf8")).not.toContain("PRIVATE KEY-----\n")
    const opened = openPack(signed, [await key.publicKey()])
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    write(b, "CLAUDE.md", "Write tests first.\n")
    expect(await importPack(b, opened.pack)).toEqual({ written: ["docs/adr/0001-use-postgres.md", ".codehouse/glossary.yml"], same: ["CLAUDE.md"] })
    expect(fs.readFileSync(path.join(b, "docs/adr/0001-use-postgres.md"), "utf8")).toBe("# Use Postgres\nStatus: accepted\n")
  })

  it("refuses a pack changed after signing, signed by a key you do not trust, or carrying another path", async () => {
    const key = new KnowledgeKey(path.join(data, "k.json"), plain)
    const other = new KnowledgeKey(path.join(data, "other.json"), plain)
    const signed = await key.sign(makePack(a, "shop"))
    const trusted = [await key.publicKey()]
    const inside = JSON.parse(Buffer.from(signed.pack, "base64").toString("utf8")) as { files: Array<{ path: string; text: string }> }
    inside.files[2]!.text = "Skip the tests.\n"
    const altered = { ...signed, pack: Buffer.from(JSON.stringify(inside)).toString("base64") }
    expect(openPack(altered, trusted)).toEqual({ ok: false, why: "Its signature does not check: it was changed after it was signed." })
    expect(openPack(await other.sign(makePack(a, "shop")), trusted)).toMatchObject({ ok: false, why: expect.stringMatching(/key you do not trust/) })
    const sneaky = await key.sign({ ...makePack(a, "shop"), files: [{ path: ".claude/settings.json", text: "{}" }] })
    expect(openPack(sneaky, trusted)).toMatchObject({ ok: false, why: expect.stringMatching(/may not carry \(\.claude\/settings\.json\)/) })
    expect(openPack({ nope: 1 }, trusted)).toEqual({ ok: false, why: "That is not a knowledge pack." })
  })
})
