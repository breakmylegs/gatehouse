// E-079: the main author of a fixture file is suggested, weighted by recency; you and bots are left out.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { historyOf, suggestReviewers } from "../src/reviewers.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const NOW = Date.parse("2026-11-20T00:00:00Z")
const ago = (days: number) => (NOW - days * 86_400_000) / 1000

describe("reviewer suggestions", () => {
  it("suggests the main author of a file, weighting recent work above old work", () => {
    const history = {
      "src/billing.ts": [
        { name: "Asha", email: "asha@x.com", at: ago(5) },
        { name: "Asha", email: "asha@x.com", at: ago(20) },
        { name: "Asha", email: "asha@x.com", at: ago(40) },
        { name: "Ben", email: "ben@x.com", at: ago(900) },
        { name: "Ben", email: "ben@x.com", at: ago(910) },
        { name: "Ben", email: "ben@x.com", at: ago(920) },
        { name: "Ben", email: "ben@x.com", at: ago(930) },
        { name: "Me", email: "me@x.com", at: ago(1) },
        { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com", at: ago(2) },
      ],
      "src/tax.ts": [{ name: "Chen", email: "chen@x.com", at: ago(10) }],
    }
    const s = suggestReviewers(history, "ME@x.com", NOW)
    expect(s.map((x) => x.name)).toEqual(["Asha", "Chen", "Ben"])
    expect(s[0]).toMatchObject({ email: "asha@x.com", files: ["src/billing.ts"], last: "2026-11-15" })
    // Ben wrote more, but long ago: fewer recent commits outweigh many old ones.
    expect(s[0]!.score).toBeGreaterThan(s[2]!.score)
    expect(s.some((x) => /me@|dependabot/.test(x.email))).toBe(false)
  })

  it("reads each file's history from git", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-rev-"))
    dirs.push(root)
    const g = (email: string, ...a: string[]) => execFileSync("git", ["-c", `user.email=${email}`, "-c", `user.name=${email.split("@")[0]}`, ...a], { cwd: root, encoding: "utf8" })
    g("a@x", "init", "-q", "-b", "main")
    fs.writeFileSync(path.join(root, "f.ts"), "1\n")
    g("asha@x.com", "add", "-A")
    g("asha@x.com", "commit", "-qm", "one")
    fs.writeFileSync(path.join(root, "f.ts"), "2\n")
    g("asha@x.com", "commit", "-qam", "two")
    fs.writeFileSync(path.join(root, "f.ts"), "3\n")
    g("ben@x.com", "commit", "-qam", "three")
    const { history } = await historyOf(root, ["f.ts"])
    expect(history["f.ts"]!.map((c) => c.email)).toEqual(["ben@x.com", "asha@x.com", "asha@x.com"])
    expect(suggestReviewers(history, undefined)[0]!.email).toBe("asha@x.com")
  })
})
