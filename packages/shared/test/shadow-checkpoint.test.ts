// G27: undo points for a folder outside git, in Codehouse's own store: a deleted file comes back, bytes stay exact,
// heavy folders and every link or junction are left out, and a folder too broad is refused.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  changesSince,
  createCheckpoint,
  listCheckpoints,
  restoreFiles,
  useShadowCheckpoints,
} from "../src/node/checkpoint.js"

let root: string
let folder: string
let store: string
let outside: string

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-shadow-")))
  folder = path.join(root, "notes")
  store = path.join(root, "data", "undo")
  outside = path.join(root, "elsewhere")
  fs.mkdirSync(path.join(folder, "node_modules", "lib"), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(folder, "plan.txt"), "line one\r\nline two\r\n")
  fs.writeFileSync(path.join(folder, "draft.md"), "# Draft\n")
  fs.writeFileSync(path.join(folder, "node_modules", "lib", "big.js"), "x")
  fs.writeFileSync(path.join(outside, "secret-of-another.txt"), "not this folder's")
  try {
    fs.symlinkSync(outside, path.join(folder, "link"), "junction")
  } catch {
    // no junctions here: that part is skipped below
  }
  useShadowCheckpoints(store)
})
afterAll(() => {
  useShadowCheckpoints(undefined)
  fs.rmSync(root, { recursive: true, force: true })
})

describe("undo points outside git (G27)", { timeout: 120_000 }, () => {
  it("has none for a folder until one is made, and never makes a store just by looking", async () => {
    await expect(listCheckpoints(folder, "s1")).rejects.toThrow(/no undo points yet/)
    expect(fs.existsSync(store)).toBe(false)
  })

  it("brings back a deleted file, byte for byte, from a store outside the folder", async () => {
    const cp = await createCheckpoint({
      cwd: folder,
      sessionId: "s1",
      label: "before: rm plan.txt",
    })
    expect(fs.existsSync(path.join(folder, ".git"))).toBe(false)
    expect(fs.readdirSync(store)).toHaveLength(1)
    fs.rmSync(path.join(folder, "plan.txt"))
    const changed = await changesSince(folder, cp.ref)
    expect(changed.files.map((f) => [f.path, f.change])).toEqual([["plan.txt", "deleted"]])
    await restoreFiles({
      cwd: folder,
      ref: cp.ref,
      paths: ["plan.txt"],
      sessionId: "s1",
      confirm: true,
    })
    expect(fs.readFileSync(path.join(folder, "plan.txt"), "utf8")).toBe("line one\r\nline two\r\n")
    expect((await listCheckpoints(folder, "s1")).map((c) => c.label)).toContain(
      "before: rm plan.txt",
    )
  })

  it("leaves out heavy folders, and never follows a link or junction out of the folder", async () => {
    const cp = await createCheckpoint({ cwd: folder, sessionId: "s2", label: "x" })
    fs.writeFileSync(path.join(folder, "node_modules", "lib", "big.js"), "changed")
    if (fs.existsSync(path.join(folder, "link")))
      fs.writeFileSync(path.join(outside, "secret-of-another.txt"), "changed too")
    const changed = (await changesSince(folder, cp.ref)).files.map((f) => f.path)
    expect(changed.some((p) => p.startsWith("node_modules/"))).toBe(false)
    expect(changed.some((p) => p.startsWith("link"))).toBe(false)
  })

  it("refuses a folder too broad to keep undo points for", async () => {
    await expect(
      createCheckpoint({ cwd: path.parse(root).root, sessionId: "s3", label: "x" }),
    ).rejects.toThrow(/too broad/)
    await expect(
      createCheckpoint({ cwd: os.homedir(), sessionId: "s3", label: "x" }),
    ).rejects.toThrow(/too broad/)
  })
})
