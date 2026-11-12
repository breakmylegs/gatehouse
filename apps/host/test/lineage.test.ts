// D-030, approval lineage on commits: a session's commit gets a note under refs/notes/codehouse naming the audit record
// written for it, and that record names the commit and verifies against the chain. Notes are never pushed.
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { AuditWriter, listAuditFiles, verifyAudit, type AuditRecord } from "@gatehouse/shared/audit"
import { HostAudit } from "../src/hostaudit.js"
import { noteCommit, readNote } from "../src/lineage.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-lineage-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

let repos = 0
function repo(): string {
  const r = path.join(dir, `repo${++repos}`)
  fs.mkdirSync(r, { recursive: true })
  const git = (...a: string[]) => execFileSync("git", a, { cwd: r, windowsHide: true })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "T")
  fs.writeFileSync(path.join(r, "a.txt"), "a\n")
  git("add", ".")
  git("commit", "-q", "-m", "first")
  return r
}

describe("approval lineage on commits (D-030)", () => {
  it("notes a commit with the audit record written for it, which names the commit and verifies against the chain", async () => {
    const r = repo()
    const auditDir = path.join(dir, "audit")
    const audit = new HostAudit(new AuditWriter({ dir: auditDir, redact: (v) => v }), () => undefined)
    await audit.record({
      session: "s1",
      event: "human_decision",
      channel: "desktop",
      tool: "Bash",
      input: { command: "git commit -m first" },
      verdict: { outcome: "allow", ruleId: "x", reason: "y", risk: 50, decidedBy: "human-desktop", policyHash: "" },
      latencyMs: 0,
    })
    const note = await noteCommit({ sessionId: "s1", cwd: r, project: "repo", audit, log: () => undefined })
    expect(note).toMatchObject({ codehouse: 1, session: "s1", auditSeq: 2 })
    // The note on the commit resolves to that record ...
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: r }).toString().trim()
    const read = await readNote(r, head)
    expect(read).toEqual(note)
    const records = listAuditFiles(auditDir).flatMap((f) =>
      fs.readFileSync(path.join(auditDir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditRecord),
    )
    const rec = records.find((x) => x.seq === read!.auditSeq)!
    expect(rec.hash).toBe(read!.auditHash)
    expect(rec.event).toBe("commit_lineage_noted")
    expect(JSON.parse(rec.inputJson ?? "{}")).toMatchObject({ commit: head })
    // ... and the chain verifies.
    expect(verifyAudit(auditDir)).toMatchObject({ ok: true })
    // The note lives on its own ref, which is not pushed.
    expect(execFileSync("git", ["for-each-ref", "refs/notes"], { cwd: r }).toString()).toContain("refs/notes/codehouse")
    // No push refspec was added for it (git config exits with 1 for a key that is not set).
    expect(spawnSync("git", ["config", "--get-all", "remote.origin.push"], { cwd: r }).status).toBe(1)
  })

  it("makes no note when the record cannot be written, or there is no commit", async () => {
    const r = repo()
    const failing = { recordWithHash: async () => undefined }
    expect(await noteCommit({ sessionId: "s1", cwd: r, project: "repo", audit: failing, log: () => undefined })).toBeUndefined()
    const plain = path.join(dir, "plain")
    fs.mkdirSync(plain, { recursive: true })
    const audit = { recordWithHash: async () => ({ seq: 1, hash: "h", ts: "t" }) }
    expect(await noteCommit({ sessionId: "s1", cwd: plain, project: "p", audit, log: () => undefined })).toBeUndefined()
  })
})
