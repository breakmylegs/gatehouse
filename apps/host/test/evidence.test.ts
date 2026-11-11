// D-003, the change evidence pack: what a change did, tied to the audit chain; kept by sha256, redacted, for its
// retention without following a junction; exported inside the signed timeline export, where one changed byte fails
// both verifiers (Node and Windows PowerShell); a 50-file pack made in under 5 s.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuditWriter, verifyAudit, verifyTimelineExport, type AuditEntry, type AuditRecord } from "@gatehouse/shared/audit"
import { REPO_ROOT } from "../src/bootstrap.js"
import { buildPack, CommandResults, EvidenceService, EvidenceStore } from "../src/evidence.js"
import { sessionRecords, sessionTimeline } from "../src/timeline.js"
import { stageTimelineExport, TimelineSigner } from "../src/timeline-export.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-evidence-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const sealer = () => ({
  protect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x33)),
  unprotect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x33)),
})
const VERIFIER = path.join(REPO_ROOT, "scripts", "verify-audit.ps1")
const ps = (dir: string): boolean => {
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, "verify-audit.ps1"), "-Dir", dir], { windowsHide: true, stdio: "ignore", timeout: 120_000 })
    return true
  } catch {
    return false
  }
}

const SINCE = { ref: "refs/gatehouse/checkpoints/s1/1", label: "before the first edit", createdAt: "2026-11-11T09:00:00.000Z" }
const verdict = (outcome: "allow" | "deny" | "escalate", ruleId: string, decidedBy: AuditEntry["verdict"]["decidedBy"]) => ({
  outcome,
  ruleId,
  reason: "r",
  risk: 30,
  decidedBy,
  policyHash: "a".repeat(64),
})
const entries: AuditEntry[] = [
  { session: "s1", event: "human_decision", channel: "desktop", tool: "Bash", toolUseId: "t1", input: { command: "npm test" }, verdict: verdict("allow", "no-rule", "human-desktop"), latencyMs: 0 },
  { session: "s1", event: "evaluate_permission", channel: "approver", tool: "Bash", toolUseId: "t2", input: { command: "npm run build" }, verdict: verdict("allow", "safe-shell", "rules"), latencyMs: 0 },
  { session: "s1", event: "floor_deny", channel: "host", tool: "Bash", toolUseId: "t3", input: { command: "rm -rf /" }, verdict: verdict("deny", "destructive-shell", "floor"), latencyMs: 0 },
  { session: "s1", event: "claim_verified", channel: "host", tool: "claims", input: { kind: "tests-pass", outcome: "confirmed" }, verdict: verdict("allow", "done-claim", "rules"), latencyMs: 0 },
  { session: "s1", event: "held_out_passed", channel: "host", tool: "heldout", input: { count: 2 }, verdict: verdict("allow", "held-out", "rules"), latencyMs: 0 },
  { session: "other", event: "human_decision", channel: "desktop", tool: "Bash", input: { command: "ls" }, verdict: verdict("allow", "no-rule", "human-desktop"), latencyMs: 0 },
]

let auditDir: string
let records: AuditRecord[]
beforeAll(async () => {
  auditDir = path.join(root, "audit")
  const w = new AuditWriter({ dir: auditDir, redact: (v) => v, now: () => new Date("2026-11-11T10:00:00Z") })
  for (const e of entries) await w.append(e)
  records = sessionRecords(auditDir, "s1")
})

const head = () => JSON.parse(fs.readFileSync(path.join(auditDir, "head.json"), "utf8")) as { seq: number; hash: string }

describe("the change evidence pack (D-003)", () => {
  it("holds the decisions, the commands and how each ended, the claims and sealed checks, each tied to its record", () => {
    const results = new CommandResults()
    results.succeeded("t1")
    results.failed("t2", "Error: Exit code 2\nbuild failed")
    const pack = buildPack({ session: "s1", project: "shop", since: SINCE, records, head: head(), results, files: [], dependencies: [], findings: [] })
    expect(pack.decisions.map((d) => [d.tool, d.outcome, d.decidedBy])).toEqual([
      ["Bash", "allow", "human-desktop"],
      ["Bash", "allow", "rules"],
      ["Bash", "deny", "floor"],
    ])
    expect(pack.commands.map((c) => [c.command, c.result, c.exitCode])).toEqual([
      ["npm test", "succeeded", 0],
      ["npm run build", "failed", 2],
    ])
    expect(pack.claims).toHaveLength(1)
    expect(pack.sealedChecks.runs).toBe(1)
    // Every item names its record and that record's hash.
    const bySeq = new Map(records.map((r) => [r.seq, r.hash]))
    for (const d of [...pack.decisions, ...pack.commands, ...pack.claims]) expect(bySeq.get(d.seq)).toBe(d.hash)
    expect(JSON.stringify(pack)).not.toContain('"ls"')
  })

  it("keeps packs by sha256, redacted, refuses a changed one, and removes old ones without following a junction", async () => {
    const dir = path.join(root, "store")
    const store = new EvidenceStore({ dir, redact: (t) => t.replace(/sk-ant-\w+/g, "[redacted]") })
    const sha = await store.put({ v: 1, session: "s1", note: "key sk-ant-abc123" })
    expect(store.text(sha)).toContain("[redacted]")
    expect(store.text(sha)).not.toContain("sk-ant-abc123")
    fs.appendFileSync(path.join(dir, `${sha}.json`), " ")
    expect(store.get(sha)).toBeUndefined()
    // An old pack goes; a file reached through a junction in the folder stays.
    const outside = path.join(root, "outside")
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, `${"f".repeat(64)}.json`), "keep me")
    fs.symlinkSync(outside, path.join(dir, "linked"), "junction")
    const old = new Date(Date.now() - 100 * 86_400_000)
    fs.utimesSync(path.join(dir, `${sha}.json`), old, old)
    expect(store.prune(90)).toBe(1)
    expect(fs.existsSync(path.join(dir, `${sha}.json`))).toBe(false)
    expect(fs.readFileSync(path.join(outside, `${"f".repeat(64)}.json`), "utf8")).toBe("keep me")
  })

  it("is exported signed, and one changed byte fails both verifiers", async () => {
    const store = new EvidenceStore({ dir: path.join(root, "packs"), redact: (t) => t })
    const pack = buildPack({ session: "s1", project: "shop", since: SINCE, records, head: head(), results: new CommandResults(), files: [], dependencies: [], findings: [] })
    const text = store.text(await store.put(pack))!
    const signer = new TimelineSigner({ dir: path.join(root, "data"), sealer })
    const stage = path.join(root, "export")
    fs.mkdirSync(stage)
    const r = await stageTimelineExport({ auditDir, session: "s1", entries: sessionTimeline(records), signer, verifier: VERIFIER, evidence: text }, stage)
    expect(r.files).toContain("evidence.json")
    expect(verifyAudit(stage).ok).toBe(true)
    expect(verifyTimelineExport(stage)).toEqual([])
    expect(ps(stage)).toBe(true)
    const file = path.join(stage, "evidence.json")
    const bytes = fs.readFileSync(file)
    const i = bytes.indexOf(Buffer.from("npm test"))
    bytes[i] = "N".charCodeAt(0)
    fs.writeFileSync(file, bytes)
    expect(verifyTimelineExport(stage).map((p) => p.reason)).toContain(
      "the signature does not match evidence.json and head.json, so one of them was changed",
    )
    expect(ps(stage)).toBe(false)
  })

  it("names a record the export does not hold as a problem (the evidence chain)", async () => {
    const store = new EvidenceStore({ dir: path.join(root, "packs2"), redact: (t) => t })
    const pack = buildPack({ session: "s1", project: "shop", since: SINCE, records, head: head(), results: new CommandResults(), files: [], dependencies: [], findings: [] })
    pack.decisions[0]!.hash = "0".repeat(64)
    const signer = new TimelineSigner({ dir: path.join(root, "data"), sealer })
    const stage = path.join(root, "export2")
    fs.mkdirSync(stage)
    await stageTimelineExport({ auditDir, session: "s1", entries: sessionTimeline(records), signer, verifier: VERIFIER, evidence: store.text(await store.put(pack))! }, stage)
    expect(verifyTimelineExport(stage).map((p) => p.reason)).toContain(`record ${pack.decisions[0]!.seq} is not the one the evidence names`)
    expect(ps(stage)).toBe(false)
  })

  it("makes a 50-file pack in under 5 seconds", async () => {
    const text = (i: number) => `export function f${i}(x: number) {\n  return x + ${i}\n}\n`
    const files = Array.from({ length: 50 }, (_, i) => ({
      path: `src/f${i}.ts`,
      change: "modified",
      added: 3,
      removed: 0,
      binary: false,
      diff: `--- a/src/f${i}.ts\n+++ b/src/f${i}.ts\n@@ -0,0 +1,3 @@\n+${text(i).trimEnd().split("\n").join("\n+")}\n`,
    }))
    const recorded: unknown[] = []
    const service = new EvidenceService({
      store: new EvidenceStore({ dir: path.join(root, "fifty"), redact: (t) => t }),
      auditDir,
      checkpoints: {
        changes: async () => ({ since: SINCE, files }),
        versions: async (_cwd, _ref, file) => ({ after: text(Number(/f(\d+)/.exec(file)![1])) }),
      },
      audit: { record: async (e) => (recorded.push(e), true) },
      version: () => "2.0.0",
      retentionDays: () => 90,
      log: () => undefined,
    })
    const started = Date.now()
    const got = await service.build({ id: "s1", cwd: root, project: "shop" })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(got?.pack.files).toHaveLength(50)
    expect(recorded[0]).toMatchObject({ event: "evidence_pack_built", input: { sha: got!.sha } })
  })
})
