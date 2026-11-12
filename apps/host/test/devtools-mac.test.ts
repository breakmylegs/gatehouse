// Mac fork: when Xcode's licence has not been accepted, Apple's git refuses to run, and with it Codehouse's checkpoints
// and every git command in a session. Codehouse.app then points its Host at the Command Line Tools (packaging/mac/
// Host.swift, DeveloperTools), and only then. Built with swiftc and run against stand-in gits.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const REPO = path.resolve(import.meta.dirname, "../../..")
const CLT = "/Library/Developer/CommandLineTools"
const can =
  process.platform === "darwin" &&
  fs.existsSync("/usr/bin/swiftc") &&
  fs.existsSync(`${CLT}/usr/bin/git`)
let dir: string
let exe: string

const fakeGit = (name: string, body: string) => {
  const f = path.join(dir, name)
  fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return f
}
const choose = (git: string, env: NodeJS.ProcessEnv = {}) =>
  execFileSync(exe, ["--devtools", git], { env: { PATH: "/usr/bin:/bin", ...env } })
    .toString()
    .trim()

beforeAll(() => {
  if (!can) return
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-devtools-mac-"))
  exe = path.join(dir, "devtools")
  const mac = (f: string) => path.join(REPO, "packaging", "mac", f)
  execFileSync(
    "/usr/bin/swiftc",
    [
      "-O",
      "-o",
      exe,
      mac("NavGuard.swift"),
      mac("Shortcut.swift"),
      mac("Host.swift"),
      mac("test/main.swift"),
    ],
    {
      env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? CLT },
    },
  )
}, 240_000)
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!can)("Apple's developer tools while Xcode's licence waits", () => {
  it("uses the Command Line Tools when git refuses for Xcode's licence", () => {
    const refusing = fakeGit(
      "refusing",
      `echo "You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license'" >&2; exit 69`,
    )
    expect(choose(refusing)).toBe(CLT)
  })

  it("changes nothing when git works, when it fails for another reason, or when DEVELOPER_DIR is yours", () => {
    expect(choose(fakeGit("working", 'echo "git version 2.54.0"'))).toBe("none")
    expect(choose(fakeGit("broken", 'echo "fatal: something else" >&2; exit 1'))).toBe("none")
    const refusing = fakeGit("refusing2", 'echo "Xcode license" >&2; exit 69')
    expect(choose(refusing, { DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" })).toBe(
      "none",
    )
  })
})

// Invariant 6 in Codehouse.app: the Host, and the Relay beside it (Paths.childEnvironment), start without any Claude
// credential the app was given.
describe.skipIf(!can)("the Host's environment in Codehouse.app", () => {
  it("leaves out every Claude credential and keeps the rest", () => {
    const out = execFileSync(exe, ["--env"], {
      env: {
        PATH: "/usr/bin:/bin",
        ANTHROPIC_API_KEY: "k",
        ANTHROPIC_AUTH_TOKEN: "t",
        CLAUDE_CODE_OAUTH_TOKEN: "o",
        KEEP_ME: "1",
      },
    }).toString()
    expect(out).not.toMatch(/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=/m)
    expect(out).toMatch(/^KEEP_ME=1$/m)
    expect(out).toMatch(/^GATEHOUSE_EXIT_ON_STDIN_CLOSE=1$/m)
  })
})
