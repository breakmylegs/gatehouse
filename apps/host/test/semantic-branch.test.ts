// T-086 (t3code review): a worktree's branch says what the work is: a kind of change when you set no prefix, your
// prefix when you did, and a few plain words of the task with a short random tail.
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { BRANCH_PREFIX, semanticBranch } from "../src/worktrees.js"

const valid = (ref: string) => {
  try {
    execFileSync("git", ["check-ref-format", "--branch", ref], { windowsHide: true, stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

describe("branch names from the task (T-086)", () => {
  it("names the kind of change and the task, in words git takes as they are", () => {
    const b = semanticBranch("Fix the login page's redirect, please!")!
    expect(b.prefix).toBe("fix/")
    expect(b.name).toMatch(/^login-page-s-redirect-[0-9a-f]{3}$/)
    expect(semanticBranch("Add CSV export to reports")!.prefix).toBe("feat/")
    expect(semanticBranch("Update the docs index")!.prefix).toBe("codehouse/")
    expect(semanticBranch("Docs: explain the cache")!.prefix).toBe("docs/")
    expect(semanticBranch("¿¡!!")).toBeUndefined()
    for (const t of ["Fix ../../etc/passwd --force", "add `rm -rf` ; echo $HOME", "Résumé café naïve"]) {
      const s = semanticBranch(t)!
      expect(valid(`${s.prefix}${s.name}`), t).toBe(true)
      expect(s.name).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it("keeps the prefix you set, when it is a valid one", () => {
    expect(semanticBranch("Fix the cache", "pk/")!.prefix).toBe("pk/")
    expect(semanticBranch("Fix the cache", "../bad")!.prefix).toBe("fix/")
    expect(BRANCH_PREFIX.test("pk/")).toBe(true)
  })
})
