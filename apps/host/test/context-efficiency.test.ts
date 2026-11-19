// D-077: the instruction blocks a session never used are listed, with their size and how many recent sessions used
// each; a block that names nothing checkable is not called unused.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { blocksOf, contextReport, projectBlocks, termsOf } from "../src/context-efficiency.js"

const CLAUDE = [
  "# Project",
  "",
  "Be brief.",
  "",
  "## Tests",
  "",
  "Run `npm run gate` before a push.",
  "",
  "## Releases",
  "",
  "Publish with `npm run release`; it writes dist-release/update.json.",
  "",
  "```sh",
  "# not a heading inside a fence",
  "```",
  "",
  "## Packaging",
  "",
  "See packaging/CodehouseApp.cs.",
].join("\n")

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-ctx-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const call = (input: unknown) => ({ inputJson: JSON.stringify(input) })

describe("the context efficiency report (D-077)", () => {
  it("splits instructions at their headings (not inside a fence) and finds what each names", () => {
    const b = blocksOf("CLAUDE.md", CLAUDE)
    expect(b.map((x) => [x.heading, x.line])).toEqual([
      ["Project", 1],
      ["Tests", 5],
      ["Releases", 9],
      ["Packaging", 17],
    ])
    expect(b[0]!.terms).toEqual([])
    expect(b[1]!.terms).toEqual(["npm run gate"])
    expect(b[2]!.terms).toEqual(["npm run release", "dist-release/update.json"])
    expect(b[3]!.terms).toEqual(["packaging/codehouseapp.cs"])
    expect(termsOf("Use `true` and https://example.com/x")).toEqual([])
  })

  it("lists the blocks a session never used, with their tokens and how many recent sessions used them", () => {
    fs.writeFileSync(path.join(root, "CLAUDE.md"), CLAUDE)
    fs.writeFileSync(path.join(root, "AGENTS.md"), "## Style\n\nKeep `src/legacy/` untouched.\n")
    const blocks = projectBlocks(root)
    const session = [call({ command: "npm run gate" }), call({ file_path: "C:\\dev\\x\\packaging\\CodehouseApp.cs" })]
    const recent = new Map([
      ["s2", [call({ command: "npm run release" })]],
      ["s3", [call({ command: "git status" })]],
    ])
    const r = contextReport(blocks, session, recent)
    const by = Object.fromEntries(r.blocks.map((b) => [b.heading, b]))
    expect(by.Tests).toMatchObject({ used: true, sessionsUsing: 0, sessions: 2 })
    expect(by.Packaging).toMatchObject({ used: true })
    expect(by.Releases).toMatchObject({ used: false, sessionsUsing: 1, sessions: 2 })
    expect(by.Style).toMatchObject({ file: "AGENTS.md", used: false, sessionsUsing: 0 })
    // Names nothing to check: neither used nor unused.
    expect(by.Project).not.toHaveProperty("used")
    expect(r.unusedTokens).toBe(by.Releases!.tokens + by.Style!.tokens)
    expect(r.totalTokens).toBe(r.blocks.reduce((a, b) => a + b.tokens, 0))
  })
})
