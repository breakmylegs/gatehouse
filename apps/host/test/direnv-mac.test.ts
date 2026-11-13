// Mac fork (owner, 13 Nov): a session starts with its folder's direnv .envrc, as a Terminal opened there would, so a
// folder's own git and gh accounts work in its sessions; only once you allowed it, and never Claude's credentials or
// sign-in, or Codehouse's own settings. Run against the real direnv, with its own allow list in a temporary folder.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { withDirenvMac } from "../src/direnv-mac.js"

const found = (() => {
  try {
    return execFileSync("/bin/sh", ["-lc", "command -v direnv"]).toString().trim() || undefined
  } catch {
    return undefined
  }
})()
const can = process.platform === "darwin" && found !== undefined
let dir: string
let env: Record<string, string | undefined>

beforeAll(() => {
  if (!can) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-direnv-mac-"))
  fs.mkdirSync(path.join(dir, "personal", "repo"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "personal", ".envrc"),
    [
      "export GH_CONFIG_DIR=$HOME/.config/gh-personal",
      "export ANTHROPIC_BASE_URL=https://elsewhere.example",
      "export CLAUDE_CONFIG_DIR=/tmp/someone-else",
      "export GATEHOUSE_LOCAL_RULES=/tmp/rules.yaml",
      "unset WORK_ONLY",
      "",
    ].join("\n"),
  )
  env = {
    PATH: `${path.dirname(found!)}:/usr/bin:/bin`,
    HOME: dir,
    XDG_DATA_HOME: path.join(dir, "data"),
    XDG_CONFIG_HOME: path.join(dir, "config"),
    WORK_ONLY: "1",
    CLAUDE_CONFIG_DIR: "/Users/you/.claude",
  }
})
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!can)("a session's folder's direnv .envrc", () => {
  it("is not loaded until you allow it, and the session starts as it would without it", async () => {
    const said: string[] = []
    const out = await withDirenvMac(path.join(dir, "personal", "repo"), env, (l) => said.push(l))
    expect(out).toBe(env)
    expect(said.join("\n")).toMatch(/direnv allow/)
  })

  it("once allowed, sets what it sets, parent folders included, but never Claude's sign-in or Codehouse's settings", async () => {
    execFileSync(found!, ["allow", path.join(dir, "personal")], { env: env as NodeJS.ProcessEnv })
    const said: string[] = []
    const out = await withDirenvMac(path.join(dir, "personal", "repo"), env, (l) => said.push(l))
    expect(out.GH_CONFIG_DIR).toBe(path.join(dir, ".config", "gh-personal"))
    expect(out.WORK_ONLY).toBeUndefined()
    expect(out.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(out.CLAUDE_CONFIG_DIR).toBe("/Users/you/.claude")
    expect(out.GATEHOUSE_LOCAL_RULES).toBeUndefined()
    expect(said.join("\n")).toMatch(/left out .*ANTHROPIC_BASE_URL/)
    // Names only: a value from an .envrc can be a secret.
    expect(said.join("\n")).not.toContain("gh-personal")
  })

  it("leaves a folder without an .envrc, and every other system, as they were", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "gh-direnv-none-"))
    expect(await withDirenvMac(elsewhere, env, () => undefined)).toBe(env)
    fs.rmSync(elsewhere, { recursive: true, force: true })
    expect(await withDirenvMac(path.join(dir, "personal"), env, () => undefined, { platform: "win32" })).toBe(env)
  })
})
