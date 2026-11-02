import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  clearPathCaches,
  findProjectRoot,
  isInside,
  lexicalResolve,
  normaliseRaw,
  realKey,
  relativeTo,
  resolvePath,
  toKey,
} from "../src/paths.js"
import { fwd, makeFixture, type Fixture } from "./helpers.js"

let fx: Fixture
beforeAll(() => {
  fx = makeFixture()
})
afterAll(() => fx.dispose())

describe("normaliseRaw and toKey", () => {
  it("turns separators and Git Bash drives into drive-letter paths", () => {
    expect(normaliseRaw("C:\\dev\\x")).toBe("C:/dev/x")
    expect(normaliseRaw("/c/dev/x")).toBe("C:/dev/x")
    expect(normaliseRaw("/c")).toBe("C:/")
    expect(normaliseRaw("/mnt/d/x")).toBe("D:/x")
    expect(normaliseRaw("/usr/bin")).toBe("/usr/bin")
  })
  it("lower-cases and drops trailing separators but keeps a drive root", () => {
    expect(toKey("C:\\Dev\\X\\")).toBe("c:/dev/x")
    expect(toKey("C:\\")).toBe("c:/")
  })
})

describe("lexicalResolve", () => {
  it("collapses dot-dot, trailing dots and spaces, and alternate data streams", () => {
    expect(lexicalResolve("a/../b/./c", "C:/p").key).toBe("c:/p/b/c")
    expect(lexicalResolve(".env.", "C:/p").key).toBe("c:/p/.env")
    expect(lexicalResolve(".env ", "C:/p").key).toBe("c:/p/.env")
    expect(lexicalResolve(".env::$DATA", "C:/p").key).toBe("c:/p/.env")
    expect(lexicalResolve("../../..", "C:/p").key).toBe("c:/")
  })
  it("flags UNC and device paths and expands the home folder", () => {
    expect(lexicalResolve("//srv/share/x", "C:/p")).toMatchObject({ unc: true, device: false })
    expect(lexicalResolve("\\\\srv\\share", "C:/p").unc).toBe(true)
    expect(lexicalResolve("\\\\?\\C:\\x", "C:/p")).toMatchObject({ unc: false, device: true })
    expect(lexicalResolve("//./PhysicalDrive0", "C:/p").device).toBe(true)
    expect(lexicalResolve("~/x", "C:/p").key).toBe(toKey(path.join(os.homedir(), "x")))
    expect(lexicalResolve("~", "C:/p").key).toBe(toKey(os.homedir()))
  })
  it("treats a Git Bash drive path as absolute", () => {
    expect(lexicalResolve("/c/Windows/x", "C:/p").key).toBe("c:/windows/x")
  })
})

describe("resolvePath", () => {
  it("resolves relative to cwd and follows existing real paths", () => {
    const r = resolvePath("src/a.ts", fx.ws)
    expect(r.key).toBe(toKey(path.join(fx.ws, "src", "a.ts")))
    expect(r.unc || r.device).toBe(false)
  })
  it("resolves a missing file under an existing folder", () => {
    const r = resolvePath("src/deep/new/file.ts", fx.ws)
    expect(r.key).toBe(toKey(path.join(fx.ws, "src", "deep", "new", "file.ts")))
  })
  it("follows a junction for existing and missing files", () => {
    if (!fs.existsSync(path.join(fx.ws, "link"))) return
    expect(resolvePath("link/notes.md", fx.ws).key).toBe(toKey(path.join(fx.out, "notes.md")))
    expect(resolvePath("link/new.txt", fx.ws).key).toBe(toKey(path.join(fx.out, "new.txt")))
  })
  it("resolves dot-dot after a junction physically", () => {
    if (!fs.existsSync(path.join(fx.ws, "link"))) return
    expect(resolvePath("link/../x.md", fx.ws).key).toBe(toKey(path.join(fx.root, "x.md")))
  })
  it("walks dot-dot through missing folders lexically", () => {
    const r = resolvePath("nope/../src/a.ts", fx.ws)
    expect(r.key).toBe(toKey(path.join(fx.ws, "src", "a.ts")))
  })
  it("expands 8.3 short names to the long name", () => {
    if (!fx.shortDir) return
    const r = resolvePath(`${fx.shortDir}/file.txt`, fx.ws)
    expect(r.key).toBe(toKey(path.join(fx.ws, fx.longDir, "file.txt")))
  })
  it("does not invent a tail for a missing path when asked not to", () => {
    const r = resolvePath("nope/never.txt", fx.ws, false, { missingTail: false })
    expect(r.key).toBe(toKey(path.join(fx.ws, "nope", "never.txt")))
  })
  it("returns UNC and device paths unresolved", () => {
    expect(resolvePath("//srv/share/x", fx.ws)).toMatchObject({ unc: true })
    expect(resolvePath("\\\\?\\C:\\x", fx.ws)).toMatchObject({ device: true })
  })
  it("records dynamic words", () => {
    expect(resolvePath("__dyn__/x", fx.ws, true).dynamic).toBe(true)
  })
  it("handles an absolute path with no drive", () => {
    const r = resolvePath("/Windows/x", fx.ws)
    expect(r.key.endsWith("/windows/x")).toBe(true)
  })
})

describe("isInside and relativeTo", () => {
  it("respects the folder boundary", () => {
    expect(isInside("c:/dev/p", "c:/dev")).toBe(true)
    expect(isInside("c:/dev", "c:/dev")).toBe(true)
    expect(isInside("c:/dev2/p", "c:/dev")).toBe(false)
    expect(isInside("c:/x", "c:/")).toBe(true)
    expect(relativeTo("c:/dev/p/a.ts", "c:/dev/p")).toBe("a.ts")
    expect(relativeTo("c:/dev/p", "c:/dev/p")).toBe("")
    expect(relativeTo("c:/other", "c:/dev/p")).toBeNull()
  })
})

describe("findProjectRoot", () => {
  it("finds the nearest git root from a nested folder", () => {
    clearPathCaches()
    expect(findProjectRoot(path.join(fx.ws, "src"))).toBe(fx.ws)
  })
  it("accepts a .git file (worktrees)", () => {
    const dir = fs.mkdtempSync(path.join(fx.root, "wt-"))
    fs.writeFileSync(path.join(dir, ".git"), "gitdir: elsewhere\n")
    fs.mkdirSync(path.join(dir, "sub"))
    clearPathCaches()
    expect(findProjectRoot(path.join(dir, "sub"))).toBe(fs.realpathSync.native(dir))
  })
  it("falls back to the folder itself with no .git above it", () => {
    const dir = fs.mkdtempSync(path.join(fx.root, "nogit-"))
    clearPathCaches()
    expect(findProjectRoot(dir)).toBe(fs.realpathSync.native(dir))
  })
  it("caches for a few seconds", () => {
    const dir = fs.mkdtempSync(path.join(fx.root, "cache-"))
    clearPathCaches()
    const first = findProjectRoot(dir)
    fs.mkdirSync(path.join(dir, ".git"))
    expect(findProjectRoot(dir)).toBe(first)
  })
  it("realKey gives a stable key for a real folder", () => {
    expect(realKey(fx.ws)).toBe(toKey(fx.ws))
    expect(realKey(fwd(path.join(fx.ws, "missing")))).toBe(toKey(path.join(fx.ws, "missing")))
  })
})
