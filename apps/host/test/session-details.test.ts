// O21: the session details panel's computer, repository and connectors. Names and states only: a server's address,
// command or settings never reach the screen, since they can carry a secret.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { connectorsOf, repoOf, sessionDetails } from "../src/session-details.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-details-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("session details (O21)", () => {
  it("names each connector, its state and kind, and nothing of its settings", () => {
    const out = connectorsOf([
      { name: "companion", status: "connected", config: { type: "sdk" } },
      { name: "Figma", status: "needs-auth", config: { type: "claudeai-proxy", url: "https://x/?token=s3cret" } },
      { name: "local", status: "failed", config: { type: "stdio", command: "node", args: ["--key=s3cret"] } },
      { status: "connected" },
      "junk",
    ])
    expect(out).toEqual([
      { name: "companion", status: "connected", kind: "in-process" },
      { name: "Figma", status: "needs-auth", kind: "claude.ai" },
      { name: "local", status: "failed", kind: "outside" },
    ])
    expect(JSON.stringify(out)).not.toContain("s3cret")
    expect(connectorsOf(undefined)).toEqual([])
  })

  it("gives the repository and branch of a folder in one, and nothing for a folder in none", async () => {
    const repo = path.join(dir, "my-repo")
    fs.mkdirSync(path.join(repo, "src"), { recursive: true })
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, windowsHide: true })
    git("init", "-q", "-b", "feature-x")
    expect(await repoOf(path.join(repo, "src"))).toMatchObject({ name: "my-repo", branch: "feature-x" })
    const plain = path.join(dir, "plain")
    fs.mkdirSync(plain)
    // A folder in no repository (the temp folder is in none).
    const got = await repoOf(plain)
    if (got) expect(got.top).not.toBe(path.resolve(plain))
    const d = await sessionDetails(repo, async () => {
      throw new Error("not started")
    })
    expect(d).toMatchObject({ computer: os.hostname(), cwd: repo, connectors: [] })
  })
})
