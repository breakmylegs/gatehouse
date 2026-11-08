// G30 and D9: the audit export as a bundle anyone can check, by the same verifiers as the log itself.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AuditWriter, verifyAudit, type AuditEntry } from "@gatehouse/shared/audit"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeAuditBundle, stageAuditBundle } from "../src/audit-bundle.js"
import { REPO_ROOT } from "../src/bootstrap.js"

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-bundle-"))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const entry = (i: number): AuditEntry => ({
  session: "s1",
  event: "evaluate_permission",
  channel: "approver",
  tool: "Bash",
  input: { command: `echo ${i}` },
  verdict: {
    outcome: "allow",
    ruleId: "safe-shell",
    reason: "ok",
    risk: 0,
    decidedBy: "rules",
    policyHash: "a".repeat(64),
  },
  latencyMs: 1,
})

/** A log with records in two months, so the chain runs across files. */
async function log(): Promise<string> {
  const dir = path.join(root, "audit")
  fs.mkdirSync(dir)
  let at = new Date("2026-10-30T10:00:00Z")
  const w = new AuditWriter({ dir, redact: (v) => v, now: () => at })
  for (let i = 0; i < 3; i++) await w.append(entry(i))
  at = new Date("2026-11-02T10:00:00Z")
  for (let i = 3; i < 5; i++) await w.append(entry(i))
  return dir
}

describe("the audit bundle", () => {
  it("holds the month files and a head that the verifier accepts, and one changed byte fails it", async () => {
    const dir = await log()
    const out = path.join(root, "bundle")
    fs.mkdirSync(out)
    const staged = stageAuditBundle(dir, out, path.join(REPO_ROOT, "scripts", "verify-audit.ps1"))
    expect(staged.records).toBe(5)
    expect(staged.files).toEqual([
      "audit-2026-10.jsonl",
      "audit-2026-11.jsonl",
      "head.json",
      "VERIFY.txt",
      "verify-audit.ps1",
    ])
    expect(verifyAudit(out)).toMatchObject({ ok: true, records: 5 })
    expect(fs.readFileSync(path.join(out, "VERIFY.txt"), "utf8")).toContain(
      "powershell -NoProfile -ExecutionPolicy Bypass -File verify-audit.ps1 -Dir",
    )
    // One byte changed in a record: the chain no longer holds.
    const f = path.join(out, "audit-2026-10.jsonl")
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("echo 1", "echo 7"))
    expect(verifyAudit(out).ok).toBe(false)
  })

  it("leaves out a record still being written, so its head always matches what it holds", async () => {
    const dir = await log()
    fs.appendFileSync(path.join(dir, "audit-2026-11.jsonl"), '{"v":1,"seq":6,"half')
    const out = path.join(root, "bundle")
    fs.mkdirSync(out)
    expect(stageAuditBundle(dir, out).records).toBe(5)
    expect(verifyAudit(out)).toMatchObject({ ok: true, records: 5 })
  })

  it("is a zip, made in the temp folder and removed straight after", async () => {
    const dir = await log()
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("codeh-audit-")).length
    const { zip, records } = await makeAuditBundle(dir)
    expect(records).toBe(5)
    expect(zip.subarray(0, 2).toString()).toBe("PK")
    expect(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("codeh-audit-")).length).toBe(
      before,
    )
  })

  // The verifier it carries needs PowerShell 7, as its note says; where pwsh is not installed this is skipped.
  const hasPwsh = (() => {
    try {
      execFileSync("pwsh", ["-NoProfile", "-Command", "1"], { windowsHide: true, stdio: "ignore" })
      return true
    } catch {
      return false
    }
  })()
  it.skipIf(!hasPwsh)(
    "is checked the same by the PowerShell verifier it carries",
    async () => {
      const dir = await log()
      const out = path.join(root, "bundle")
      fs.mkdirSync(out)
      stageAuditBundle(dir, out, path.join(REPO_ROOT, "scripts", "verify-audit.ps1"))
      const said = execFileSync(
        "pwsh",
        ["-NoProfile", "-File", path.join(out, "verify-audit.ps1"), "-Dir", out],
        { encoding: "utf8", windowsHide: true },
      )
      expect(said).toMatch(/Audit chain OK: 5 records in 2 file/)
    },
    60_000,
  )
})
