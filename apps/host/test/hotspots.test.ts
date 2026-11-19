// D-069: the hotspot map. The top hotspot, ranked by churn, complexity and agent failure rate, matches the fixture;
// complexity counts decision points, not comments or strings; failures come from the audit; churn comes from git.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { fileOf } from "../src/failure-taxonomy.js"
import { churnOf, complexityOf, failuresOf, rankHotspots } from "../src/hotspots.js"

describe("the hotspot map (D-069)", () => {
  it("ranks the file that changes often, is tangled and where agents fail first, ahead of one strong on a single measure", () => {
    const ranked = rankHotspots([
      // Changes most, but simple and never a failure.
      { file: "src/config.ts", churn: 20, complexity: 2, failures: 0 },
      // The most tangled, rarely changed.
      { file: "src/legacy.ts", churn: 1, complexity: 90, failures: 0 },
      // Often changed, tangled, and where agent work goes wrong.
      { file: "src/billing.ts", churn: 14, complexity: 60, failures: 6 },
      // Never changed and never a failure: not a hotspot at all.
      { file: "src/still.ts", churn: 0, complexity: 99, failures: 0 },
    ])
    expect(ranked[0]!.file).toBe("src/billing.ts")
    expect(ranked.map((h) => h.file)).not.toContain("src/still.ts")
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
  })

  it("counts decision points, never words in comments or strings", () => {
    expect(complexityOf("if (a && b) { for (const x of y) {} } else if (c) {} const z = d ?? e")).toBe(5)
    expect(complexityOf('// if for while\nconst s = "if (a) && b"\n/* case catch */')).toBe(0)
  })

  it("takes agent failures per file from the audit, for this project only", () => {
    const rec = (cwd: string, event: string, input: unknown) => ({ cwd, event, inputJson: JSON.stringify(input) })
    const m = failuresOf(
      [
        rec("C:/p", "tool_failed", { tool: "Edit", file: "src/billing.ts" }),
        rec("C:/p", "edit_files_reverted", { files: ["src/billing.ts", "src/b.ts"] }),
        rec("C:/other", "tool_failed", { tool: "Edit", file: "src/billing.ts" }),
        rec("C:/p", "tool_failed", { tool: "Bash" }),
      ],
      "C:/p",
    )
    expect(Object.fromEntries(m)).toEqual({ "src/billing.ts": 2, "src/b.ts": 1 })
    expect(fileOf({ file_path: "C:/p/src/a.ts" }, "C:/p")).toEqual({ file: "src/a.ts" })
    expect(fileOf({ file_path: "src/a.ts" }, "C:/p")).toEqual({ file: "src/a.ts" })
    expect(fileOf({ file_path: "C:/elsewhere/x.ts" }, "C:/p")).toEqual({})
    expect(fileOf({ command: "ls" }, "C:/p")).toEqual({})
  })

  it("counts churn from the project's git history", { timeout: 120_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-hot-"))
    const env = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "false" }
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: dir, env, stdio: "ignore" })
    try {
      g("init", "-q")
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(path.join(dir, "hot.ts"), `export const n = ${i}\n`)
        if (i === 0) fs.writeFileSync(path.join(dir, "cold.ts"), "export const c = 1\n")
        g("add", "-A")
        g("commit", "-qm", `change ${i}`)
      }
      expect(Object.fromEntries(await churnOf(dir))).toEqual({ "hot.ts": 3, "cold.ts": 1 })
      expect((await churnOf(path.join(dir, "not-a-repo"))).size).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
