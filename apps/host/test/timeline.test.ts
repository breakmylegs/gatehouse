// C-010, the audit-backed session timeline: every call in audit order, with its decision, rule, risk and approver, its
// records, its file and the checkpoint taken while it waited; read from a real hash-chained log of 1,000 records.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { AuditWriter } from "@gatehouse/shared/audit"
import { HostAudit } from "../src/hostaudit.js"
import { sessionRecords, sessionTimeline } from "../src/timeline.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-timeline-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const verdict = (outcome: "allow" | "deny" | "escalate", ruleId: string, decidedBy: string, risk = 20) => ({
  outcome,
  ruleId,
  reason: "r",
  risk,
  decidedBy: decidedBy as "rules",
  policyHash: "h",
})

describe("the session timeline (C-010)", () => {
  it("puts 1,000 records in audit order across months, one entry a call, each ending in its last decision", async () => {
    const auditDir = path.join(dir, "a1")
    // Two months, so records come from two files; the clock is not what orders them.
    let month = new Date("2026-10-31T23:59:00Z")
    const writer = new AuditWriter({ dir: auditDir, redact: (v) => v, now: () => month })
    const audit = new HostAudit(writer, () => undefined)
    for (let i = 0; i < 500; i++) {
      if (i === 250) month = new Date("2026-11-01T00:01:00Z")
      const call = `t${i}`
      const session = i % 5 === 4 ? "other" : "s1"
      await audit.record({ session, event: "evaluate_permission", channel: "approver", tool: "Bash", toolUseId: call, cwd: "C:/p", input: { command: `step ${i}` }, verdict: verdict("escalate", "no-rule", "rules", 40), latencyMs: 0 })
      await audit.record({ session, event: "human_decision", channel: i % 2 ? "phone" : "desktop", tool: "Bash", toolUseId: call, cwd: "C:/p", input: { command: `step ${i}` }, verdict: verdict(i % 7 === 0 ? "deny" : "allow", "no-rule", i % 2 ? "human-phone" : "human-desktop", 40), latencyMs: 0 })
    }
    const records = sessionRecords(auditDir, "s1")
    expect(records).toHaveLength(800)
    const entries = sessionTimeline(records)
    expect(entries).toHaveLength(400)
    // In audit order: each entry's place is its first record, and they only go up.
    for (let i = 1; i < entries.length; i++) expect(entries[i]!.seq).toBeGreaterThan(entries[i - 1]!.seq)
    expect(entries[0]).toMatchObject({ kind: "call", summary: "step 0", event: "human_decision", outcome: "deny", decidedBy: "human-desktop", records: [1, 2] })
    expect(entries[1]).toMatchObject({ summary: "step 1", outcome: "allow", decidedBy: "human-phone", channel: "phone" })
    // Another session's calls are not in it.
    expect(entries.some((e) => /step (4|9|14)$/.test(e.summary))).toBe(false)
    // 1,000 locked, chained writes take a while on a busy laptop.
  }, 120_000)

  it("keeps events apart, names an edit's file, and gives a checkpoint to the call that waited for it", () => {
    const rec = (seq: number, ts: string, o: Partial<{ event: string; tool: string; toolUseId: string; input: unknown; decidedBy: string; outcome: string }>) => ({
      v: 1 as const,
      seq,
      ts,
      prevHash: "p",
      hash: "h",
      session: "s",
      event: o.event ?? "evaluate_permission",
      channel: "host",
      tool: o.tool ?? "Edit",
      ...(o.toolUseId ? { toolUseId: o.toolUseId } : {}),
      inputJson: JSON.stringify(o.input ?? {}),
      verdict: { ...verdict((o.outcome as "allow") ?? "escalate", "no-rule", o.decidedBy ?? "rules"), reason: "r" },
      latencyMs: 0,
    })
    const records = [
      rec(3, "2026-11-10T10:00:05Z", { toolUseId: "b", tool: "Bash", input: { command: "npm test" }, event: "human_decision", decidedBy: "human-desktop", outcome: "allow" }),
      rec(1, "2026-11-10T10:00:00Z", { toolUseId: "a", input: { file_path: "C:/p/src/a.ts", old_string: "x", new_string: "y" } }),
      rec(2, "2026-11-10T10:00:03Z", { toolUseId: "a", event: "human_decision", decidedBy: "human-phone", outcome: "allow" }),
      rec(4, "2026-11-10T10:00:06Z", { event: "extreme_carry_on", tool: "session" }),
    ] as unknown as Parameters<typeof sessionTimeline>[0]
    const cp = { ref: "refs/gatehouse/checkpoints/s/1", label: "before: Edit a.ts", createdAt: "2026-11-10T10:00:01Z" }
    const entries = sessionTimeline(records, [cp])
    expect(entries.map((e) => [e.seq, e.kind])).toEqual([
      [1, "call"],
      [3, "call"],
      [4, "event"],
    ])
    expect(entries[0]).toMatchObject({ file: "C:/p/src/a.ts", decidedBy: "human-phone", checkpoint: cp, records: [1, 2] })
    expect(entries[1]!.checkpoint).toBeUndefined()
    expect(entries[2]).toMatchObject({ event: "extreme_carry_on" })
  })
})
