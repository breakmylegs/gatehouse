// D-027, step-exact reconstruction: the tree rebuilt at a step from the checkpoint before it and the recorded edits has
// the hash of the checkpoint taken at that point; nothing of the session runs (git only reads objects and writes a
// tree); a redacted edit stops the rebuild there and says so.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { AuditWriter, type AuditEntry } from "@gatehouse/shared/audit"
import { createCheckpoint, listCheckpoints } from "@gatehouse/shared/node"
import { rebuildAt, REBUILD_GIT, type RebuildGit } from "../src/rebuild.js"
import { sessionRecords } from "../src/timeline.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-rebuild-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, windowsHide: true, encoding: "utf8" }).trim()
const pause = () => new Promise((r) => setTimeout(r, 30))
const allow = { outcome: "allow" as const, ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules" as const, policyHash: "h" }
const call = (tool: string, toolUseId: string, input: Record<string, unknown>): AuditEntry => ({
  session: "s1",
  event: "evaluate_permission",
  channel: "approver",
  tool,
  toolUseId,
  input,
  verdict: allow,
  latencyMs: 0,
})

describe("step-exact reconstruction (D-027)", () => {
  it("rebuilds the tree at a step with the checkpoint's hash, running nothing of the session", async () => {
    const repo = path.join(root, "repo")
    fs.mkdirSync(path.join(repo, "src"), { recursive: true })
    sh(repo, "init", "-q")
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1\n")
    sh(repo, "add", ".")
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "one")
    await createCheckpoint({ cwd: repo, sessionId: "s1", label: "before the first edit", excludeGlobs: [] })
    await pause()
    const audit = path.join(root, "audit")
    const w = new AuditWriter({ dir: audit, redact: (v) => v })
    // What the session did: an edit, a new file, and a shell command that would leave a mark if it ran.
    const a = path.join(repo, "src", "a.ts")
    fs.writeFileSync(a, "export const a = 2\n")
    await w.append(call("Edit", "t1", { file_path: a, old_string: "= 1", new_string: "= 2" }))
    const b = path.join(repo, "src", "b.ts")
    fs.writeFileSync(b, "export const b = 3\n")
    await w.append(call("Write", "t2", { file_path: b, content: "export const b = 3\n" }))
    await w.append(call("Bash", "t3", { command: `node -e "require('fs').writeFileSync('pwned.txt','x')"` }))
    await pause()
    const later = await createCheckpoint({ cwd: repo, sessionId: "s1", label: "before a request", excludeGlobs: [] })
    const records = sessionRecords(audit, "s1")
    const ran: string[][] = []
    const spy: RebuildGit = (cwd, args, env) => {
      ran.push(args)
      return new Promise((resolve, reject) => {
        try {
          resolve(execFileSync("git", args, { cwd, env: { ...process.env, ...env }, windowsHide: true, encoding: "utf8" }).trim())
        } catch (e) {
          reject(e as Error)
        }
      })
    }
    const out = path.join(root, "out1")
    const r = await rebuildAt({ cwd: repo, seq: records.at(-1)!.seq, records, checkpoints: await listCheckpoints(repo, "s1"), dir: out, git: spy })
    expect(r.applied).toBe(2)
    expect(r.tree).toBe(sh(repo, "rev-parse", `${later.commit}^{tree}`))
    expect(fs.readFileSync(path.join(out, "src", "a.ts"), "utf8")).toBe("export const a = 2\n")
    // The shell command was not run, only named.
    expect(r.marks).toEqual([`A shell command ran at record ${records.at(-1)!.seq}; what it changed is not replayed.`])
    expect(fs.existsSync(path.join(out, "pwned.txt"))).toBe(false)
    expect(fs.existsSync(path.join(repo, "pwned.txt"))).toBe(false)
    expect(ran.every((args) => REBUILD_GIT.has(args.find((x) => !x.startsWith("-") && !x.includes("="))!))).toBe(true)
  })

  it("stops before an edit recorded with part of it redacted, and says so", async () => {
    const repo = path.join(root, "repo2")
    fs.mkdirSync(repo)
    sh(repo, "init", "-q")
    fs.writeFileSync(path.join(repo, "a.txt"), "token=abc\n")
    await createCheckpoint({ cwd: repo, sessionId: "s1", label: "start", excludeGlobs: [] })
    await pause()
    const audit = path.join(root, "audit2")
    const w = new AuditWriter({ dir: audit, redact: (v) => v })
    await w.append(call("Edit", "t1", { file_path: path.join(repo, "a.txt"), old_string: "token=[REDACTED:term]", new_string: "token=new" }))
    await w.append(call("Write", "t2", { file_path: path.join(repo, "b.txt"), content: "after\n" }))
    const records = sessionRecords(audit, "s1")
    const r = await rebuildAt({ cwd: repo, seq: records.at(-1)!.seq, records, checkpoints: await listCheckpoints(repo, "s1"), dir: path.join(root, "out2") })
    expect(r.exact).toBe(false)
    expect(r.applied).toBe(0)
    expect(r.marks[0]).toMatch(/redacted, so the rebuild stops before it/)
    expect(fs.readFileSync(path.join(r.dir, "a.txt"), "utf8")).toBe("token=abc\n")
    expect(fs.existsSync(path.join(r.dir, "b.txt"))).toBe(false)
  })
})
