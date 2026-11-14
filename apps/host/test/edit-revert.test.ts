// T-042 (t3code review): Edit from here puts files back only for a session in its own worktree, and never while
// another open session works in that folder, inside it or around it.
import { describe, expect, it } from "vitest"
import { cannotRevert, sharesFolder } from "../src/edit-revert.js"

const me = { id: "s1", cwd: "C:\\dev\\wt\\shop-fix", worktree: { branch: "fix", repo: "C:\\dev\\shop" } }
const open = (id: string, cwd: string, state = "idle") => ({ id, cwd, state, project: id })

describe("putting files back from Edit (T-042)", () => {
  it("knows the same folder, one inside and one around, without case on Windows", () => {
    expect(sharesFolder("C:\\dev\\wt\\shop-fix", "c:\\DEV\\wt\\shop-fix\\", "win32")).toBe(true)
    expect(sharesFolder("C:\\dev\\wt\\shop-fix\\src", "C:\\dev\\wt\\shop-fix", "win32")).toBe(true)
    expect(sharesFolder("C:\\dev\\wt", "C:\\dev\\wt\\shop-fix", "win32")).toBe(true)
    expect(sharesFolder("C:\\dev\\wt\\shop-fix2", "C:\\dev\\wt\\shop-fix", "win32")).toBe(false)
    expect(sharesFolder("/Users/a/Shop", "/users/a/shop", "linux")).toBe(false)
  })

  it("refuses a session outside a worktree, and one whose folder another open session shares", () => {
    expect(cannotRevert({ id: "s1", cwd: "C:\\dev\\shop" }, [], "win32")).toMatch(/own worktree/)
    expect(cannotRevert(me, [open("s1", me.cwd), open("s2", "C:\\dev\\shop")], "win32")).toBeUndefined()
    expect(cannotRevert(me, [open("s2", "C:\\dev\\wt\\shop-fix\\docs")], "win32")).toMatch(/Another open session/)
    expect(cannotRevert(me, [open("s2", me.cwd, "ended")], "win32")).toBeUndefined()
  })
})
