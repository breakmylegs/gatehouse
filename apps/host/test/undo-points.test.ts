// G27: an undo point before every command that would delete files or throw work away, however it is allowed, and not
// a second one when the same call is then escalated.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyStore } from "@gatehouse/policy"
import { listCheckpoints } from "@gatehouse/shared/node"
import { CheckpointManager } from "../src/checkpoints.js"

const REPO = path.resolve(import.meta.dirname, "../../..")
let dir: string
let manager: CheckpointManager

beforeAll(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-undo-points-")))
  execFileSync("git", ["init", "--quiet"], { cwd: dir, windowsHide: true })
  fs.writeFileSync(path.join(dir, "a.txt"), "keep me\n")
  const store = new PolicyStore({ rulesPath: path.join(REPO, "policy", "rules.yaml") })
  store.load()
  manager = new CheckpointManager({
    config: () =>
      ({
        checkpoints: { beforeEscalation: true, editBursts: true, burstWindowMs: 60_000 },
      }) as never,
    policy: () => store.current,
    log: () => undefined,
  })
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("undo points before commands with effects (G27)", { timeout: 120_000 }, () => {
  it("takes one before a delete, none before a command that deletes nothing", async () => {
    expect(await manager.beforeEffects("s1", dir, "Bash", { command: "ls -la" })).toBeUndefined()
    expect(await manager.beforeEffects("s1", dir, "Read", { file_path: "a.txt" })).toBeUndefined()
    const cp = await manager.beforeEffects("s1", dir, "Bash", { command: "rm a.txt" })
    expect(cp?.label).toBe("before: Bash rm a.txt")
    // The same call, escalated a moment later, does not take a second one.
    expect(await manager.beforeEscalation("s1", dir, "Bash rm a.txt")).toBeUndefined()
    expect((await listCheckpoints(dir, "s1")).length).toBe(1)
    // A different call still does.
    expect(await manager.beforeEscalation("s1", dir, "Bash npm install x")).toBeDefined()
  })
})
