import { describe, expect, it } from "vitest"
import { compileGlobs, matchAnyWildcard, matchWildcard } from "../src/match.js"

describe("matchWildcard", () => {
  it("lets * match any run of characters, including spaces and slashes", () => {
    expect(matchWildcard("git status*", "git status --short", false)).toBe(true)
    expect(matchWildcard("git status*", "git status", false)).toBe(true)
    expect(matchWildcard("rm -rf /*", "rm -rf /", false)).toBe(true)
    expect(matchWildcard("a*c", "a/b c", false)).toBe(true)
  })

  it("anchors both ends", () => {
    expect(matchWildcard("git status", "git status --short", false)).toBe(false)
    expect(matchWildcard("git status", "xgit status", false)).toBe(false)
    expect(matchWildcard("status*", "git status", false)).toBe(false)
  })

  it("treats everything except * as literal text", () => {
    expect(matchWildcard("a.b", "axb", false)).toBe(false)
    expect(matchWildcard("a.b", "a.b", false)).toBe(true)
    expect(matchWildcard("git log (x)", "git log (x)", false)).toBe(true)
    expect(matchWildcard("x?", "xy", false)).toBe(false)
    expect(matchWildcard("[a]", "a", false)).toBe(false)
    expect(matchWildcard("a|b", "a", false)).toBe(false)
    expect(matchWildcard("^a$", "a", false)).toBe(false)
  })

  it("is case sensitive unless asked, and matches across newlines", () => {
    expect(matchWildcard("Get-ChildItem*", "get-childitem", false)).toBe(false)
    expect(matchWildcard("Get-ChildItem*", "get-childitem -r", true)).toBe(true)
    expect(matchWildcard("a*b", "a\nb", false)).toBe(true)
  })

  it("matchAnyWildcard needs one hit", () => {
    expect(matchAnyWildcard(["x", "y*"], "yes", false)).toBe(true)
    expect(matchAnyWildcard(["x", "y*"], "no", false)).toBe(false)
    expect(matchAnyWildcard([], "no", false)).toBe(false)
  })
})

describe("compileGlobs", () => {
  it("matches dot files and ignores case", () => {
    const m = compileGlobs(["**/.env", "**/.env.*"])
    expect(m("c:/dev/p/.env")).toBe(true)
    expect(m("c:/dev/p/.ENV.local")).toBe(true)
    expect(m("c:/dev/p/env")).toBe(false)
    expect(m("c:/dev/p/a.env.ts")).toBe(false)
  })

  it("treats parentheses as literal text (Program Files (x86))", () => {
    const m = compileGlobs(["C:/Program Files (x86)/**"])
    expect(m("c:/program files (x86)/a/b.txt")).toBe(true)
    expect(m("c:/program files x86/a")).toBe(false)
  })

  it("matches a directory itself against dir/** patterns", () => {
    const m = compileGlobs(["**/.aws/**", "C:/Windows/**"])
    expect(m("c:/dev/p/.aws")).toBe(true)
    expect(m("c:/windows")).toBe(true)
    expect(m("c:/windows/system32")).toBe(true)
    expect(m("c:/windowsx")).toBe(false)
  })

  it("reuses compiled matchers", () => {
    expect(compileGlobs(["a/**"])).toBe(compileGlobs(["a/**"]))
  })
})
