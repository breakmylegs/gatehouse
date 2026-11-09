// Backlog G35: search across a session's files with git grep, and replace with the changed lines shown first, only in
// files still as shown, never in a file the floor blocks.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { applyReplace, previewReplace, readerFor, searchFiles } from "../src/file-search.js"
import { insideRoot } from "../src/files-api.js"

let root: string
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-search-")))
  execFileSync("git", ["init", "--quiet"], { cwd: root, windowsHide: true })
  write("src/basket.ts", "export const basket = []\n// basket total\nconst Basket = 1\n")
  write("src/pay.ts", "pay(basket)\n")
  write(".gitignore", "dist/\n")
  write("dist/basket.js", "basket\n")
  write(".env", "SECRET=basket\n")
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

// Made when used: the folder is made before the tests run.
const read = (rel: string) =>
  readerFor(root, insideRoot, async (abs) =>
    abs.endsWith(".env") ? "a secrets file" : undefined,
  )(rel)

describe("searching files", { timeout: 60_000 }, () => {
  it("finds every matching line, skipping what git ignores, ignoring case unless asked", async () => {
    const { matches } = await searchFiles(root, { pattern: "basket" })
    const where = matches.map((m) => `${m.path}:${m.line}`)
    expect(where).toEqual(
      expect.arrayContaining([
        "src/basket.ts:1",
        "src/basket.ts:2",
        "src/basket.ts:3",
        "src/pay.ts:1",
      ]),
    )
    expect(where.some((w) => w.startsWith("dist/"))).toBe(false)
    const exact = await searchFiles(root, { pattern: "Basket", caseSensitive: true })
    expect(exact.matches.map((m) => m.line)).toEqual([3])
  })

  it("takes a regular expression, and refuses one it cannot read", async () => {
    const { matches } = await searchFiles(root, { pattern: "^export\\s+const", regex: true })
    expect(matches.map((m) => m.path)).toEqual(["src/basket.ts"])
    await expect(searchFiles(root, { pattern: "(", regex: true })).rejects.toThrow(
      /regular expression/,
    )
    await expect(searchFiles(root, { pattern: "" })).rejects.toThrow(/1 to 500/)
  })

  it("works in a folder that is not a repository", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "gh-search-plain-"))
    try {
      fs.writeFileSync(path.join(plain, "notes.txt"), "a basket\n")
      expect((await searchFiles(plain, { pattern: "basket" })).matches).toEqual([
        { path: "notes.txt", line: 1, text: "a basket" },
      ])
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe("replacing across files", () => {
  it("shows each changed line first, leaves blocked files alone, and writes only files still as shown", async () => {
    const o = { pattern: "basket" }
    const preview = await previewReplace(["src/basket.ts", "src/pay.ts", ".env"], o, "cart", read)
    expect(preview.skipped).toEqual([
      { path: ".env", why: "Blocked by the policy: a secrets file" },
    ])
    expect(preview.files.find((f) => f.path === "src/basket.ts")?.lines).toEqual([
      { line: 1, before: "export const basket = []", after: "export const cart = []" },
      { line: 2, before: "// basket total", after: "// cart total" },
      { line: 3, before: "const Basket = 1", after: "const cart = 1" },
    ])
    // Someone changed pay.ts after you looked: it is left as it is.
    write("src/pay.ts", "pay(basket, now)\n")
    const writes: string[] = []
    const done = await applyReplace(preview.files, o, "cart", read, async (abs, text) => {
      writes.push(path.basename(abs))
      fs.writeFileSync(abs, text)
    })
    expect(done.changed).toEqual(["src/basket.ts"])
    expect(done.count).toBe(3)
    expect(done.skipped[0]).toMatchObject({ path: "src/pay.ts", why: /changed since you looked/ })
    expect(writes).toEqual(["basket.ts"])
    expect(fs.readFileSync(path.join(root, "src/basket.ts"), "utf8")).toBe(
      "export const cart = []\n// cart total\nconst cart = 1\n",
    )
    expect(fs.readFileSync(path.join(root, ".env"), "utf8")).toBe("SECRET=basket\n")
  })

  it("refuses a path out of the folder", async () => {
    const p = await previewReplace(["../outside.txt"], { pattern: "x" }, "y", read)
    expect(p.files).toEqual([])
    expect(p.skipped[0]?.path).toBe("../outside.txt")
  })
})
