// E-043: a reproduction test is accepted only when it fails before the fix; after the fix the same test must pass, and
// it is then locked.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { confirmFails, confirmPasses, reproPrompt, ReproStore, type ReproRun } from "../src/repro.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-repro-"))
  dirs.push(root)
  fs.mkdirSync(path.join(root, "test"))
  fs.writeFileSync(path.join(root, "test", "total.test.js"), "expect(total([1, 2])).toBe(3)\n")
  return { root, store: new ReproStore(path.join(root, "..", `${path.basename(root)}-repro.json`)) }
}
const exits = (...codes: number[]): ReproRun => {
  const queue = [...codes]
  return async () => ({ ran: true, exitCode: queue.shift() ?? 0, output: "" })
}

describe("verified reproduction recipes", () => {
  it("rejects a reproduction that passes before the fix", async () => {
    const { root, store } = project()
    const r = await confirmFails(root, "test/total.test.js", "npx vitest run test/total.test.js", "total() adds wrongly", exits(0), store)
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/^Rejected: the test passes before the fix/) })
    expect(store.read(root)).toEqual([])
  })

  it("accepts one that fails, then locks it once the same test passes after the fix", async () => {
    const { root, store } = project()
    const lock = vi.fn(async () => undefined)
    expect(await confirmFails(root, "test/total.test.js", "npx vitest run test/total.test.js", "total() adds wrongly", exits(1), store)).toMatchObject({ ok: true, repro: { stage: "failed-before", file: "test/total.test.js" } })
    expect(await confirmPasses(root, "test/total.test.js", exits(1), store, lock)).toEqual({ ok: false, message: expect.stringMatching(/still fails/) })
    expect(lock).not.toHaveBeenCalled()
    expect(await confirmPasses(root, "test/total.test.js", exits(0), store, lock)).toMatchObject({ ok: true, repro: { stage: "verified" } })
    expect(lock).toHaveBeenCalledWith("test/total.test.js")
  })

  it("rejects a pass after the test was changed, and one never confirmed failing", async () => {
    const { root, store } = project()
    const lock = vi.fn(async () => undefined)
    expect(await confirmPasses(root, "test/total.test.js", exits(0), store, lock)).toEqual({ ok: false, message: expect.stringMatching(/fails before the fix first/) })
    await confirmFails(root, "test/total.test.js", "npx vitest run test/total.test.js", "bug", exits(1), store)
    fs.writeFileSync(path.join(root, "test", "total.test.js"), "expect(true).toBe(true)\n")
    expect(await confirmPasses(root, "test/total.test.js", exits(0), store, lock)).toEqual({ ok: false, message: expect.stringMatching(/^Rejected: the test was changed after it failed/) })
    expect(lock).not.toHaveBeenCalled()
  })

  it("takes only a test inside the project, says when it was not run, and asks Claude not to fix yet", async () => {
    const { root, store } = project()
    // A real test file beside the project, not in it.
    const outside = path.join(path.dirname(root), `${path.basename(root)}-elsewhere.test.js`)
    fs.writeFileSync(outside, "expect(1).toBe(2)\n")
    dirs.push(outside)
    expect(await confirmFails(root, `../${path.basename(outside)}`, "x", "b", exits(1), store)).toEqual({ ok: false, message: expect.stringMatching(/must be a file in the project/) })
    expect(await confirmFails(root, "test/total.test.js", "x", "b", async () => ({ ran: false, exitCode: null, output: "", refused: "the rules denied it" }), store)).toEqual({ ok: false, message: "It was not run: the rules denied it." })
    expect(reproPrompt("total() adds wrongly")).toMatch(/Do not fix the bug yet: the test must fail now/)
  })
})
