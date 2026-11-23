// E-055: a handover note marks a file it names that has not changed; the next session in the folder receives it, once.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { handoverReply, handoverText, HandoverStore } from "../src/handover.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-handover-"))
  dirs.push(root)
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: root })
  g("init", "-q")
  fs.mkdirSync(path.join(root, "src"))
  fs.writeFileSync(path.join(root, "src", "cart.ts"), "export const total = 1\n")
  fs.writeFileSync(path.join(root, "src", "untouched.ts"), "export const x = 1\n")
  g("add", "-A")
  g("commit", "-qm", "one")
  // The session changed cart.ts and added a test; untouched.ts it did not change.
  fs.writeFileSync(path.join(root, "src", "cart.ts"), "export const total = 2\n")
  fs.writeFileSync(path.join(root, "src", "cart.test.ts"), "test\n")
  const store = new HandoverStore(path.join(root, "..", `${path.basename(root)}-handover.json`))
  dirs.push(store.file)
  return { root, store }
}

describe("agent handover notes", () => {
  it("marks a file the note names that has not changed", async () => {
    const { root, store } = repo()
    const n = await store.write(root, "s1", { state: "Cart totals half done", next: ["Round to pence"], risks: ["Tax not handled"], questions: ["VAT inclusive?"], files: ["src/cart.ts", "src\\cart.test.ts", "src/untouched.ts"] })
    expect(n.files).toEqual([
      { path: "src/cart.ts", changed: true },
      { path: "src/cart.test.ts", changed: true },
      { path: "src/untouched.ts", changed: false },
    ])
    expect(handoverReply(n)).toMatch(/have not changed in the working folder, so the note marks them: src\/untouched\.ts/)
    expect(handoverText(n)).toContain("- src/untouched.ts (NOT changed in the working folder")
  })

  it("gives the next session in the folder the note, once, and not the session that wrote it", async () => {
    const { root, store } = repo()
    await store.write(root, "s1", { state: "Cart totals half done", next: ["Round to pence"] })
    expect(store.takeFor(root, "s1")).toBeUndefined()
    const got = store.takeFor(root.toUpperCase(), "s2")
    expect(got).toMatchObject({ state: "Cart totals half done", deliveredTo: "s2" })
    expect(handoverText(got!)).toMatch(/^A handover note from the last session in this folder[\s\S]*Where it stands: Cart totals half done[\s\S]*Next steps:\n- Round to pence/)
    expect(store.takeFor(root, "s3")).toBeUndefined()
    expect(store.takeFor(path.join(root, "src"), "s4")).toBeUndefined()
  })

  it("passes over a note older than two weeks", async () => {
    const { root, store } = repo()
    await store.write(root, "s1", { state: "old" })
    expect(store.takeFor(root, "s2", Date.now() + 15 * 86_400_000)).toBeUndefined()
  })
})
