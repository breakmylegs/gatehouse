// D-031, evidence queries: saved questions over a JSONL index of the audit log, kept up to date by reading only what
// the log gained; each answers what it says, results are redacted, and 100,000 records answer in under 2 s.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { AuditWriter, type AuditEntry } from "@gatehouse/shared/audit"
import { AuditIndex } from "../src/audit-index.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-aindex-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const redact = (t: string) => t.replace(/sk-ant-\w+/g, "[REDACTED:anthropic-key]")
const rec = (tool: string, command: string, outcome: "allow" | "deny" | "escalate", decidedBy: AuditEntry["verdict"]["decidedBy"], project = "shop"): AuditEntry => ({
  session: "s1",
  event: "human_decision",
  channel: "desktop",
  tool,
  project,
  input: tool === "WebFetch" ? { url: command } : { command },
  verdict: { outcome, ruleId: "r", reason: "x", risk: 10, decidedBy, policyHash: "h" },
  latencyMs: 0,
})

describe("evidence queries (D-031)", () => {
  it("answers each saved question, redacted, and reads only what the log gained", async () => {
    const auditDir = path.join(root, "audit")
    const w = new AuditWriter({ dir: auditDir, redact: (v) => v })
    await w.append(rec("Bash", "npm test", "allow", "human-desktop"))
    await w.append(rec("Bash", "rm -rf /", "deny", "floor"))
    await w.append(rec("Bash", "curl -H 'x-api-key: sk-ant-abc123' https://api.test", "allow", "extreme-mode"))
    await w.append(rec("WebFetch", "https://docs.test", "allow", "rules", "atlas"))
    await w.append(rec("Bash", "ls", "deny", "rules", "atlas"))
    const index = new AuditIndex({ auditDir, dir: path.join(root, "index") })
    const q = (t: Parameters<AuditIndex["query"]>[0], project?: string) => index.query(t, { redact, ...(project ? { project } : {}) })
    expect((await q("who-approved")).results.map((r) => r.summary)).toEqual(["npm test"])
    expect((await q("denies", "shop")).results.map((r) => r.summary)).toEqual(["rm -rf /"])
    expect((await q("denies", "atlas")).results.map((r) => r.summary)).toEqual(["ls"])
    const net = await q("network")
    expect(net.results.map((r) => r.tool)).toEqual(["WebFetch", "Bash"])
    expect(JSON.stringify(net)).not.toContain("sk-ant-abc123")
    expect((await q("extreme")).total).toBe(1)
    // A record added later is found without indexing the rest again.
    const before = fs.readFileSync(path.join(root, "index", fs.readdirSync(path.join(root, "index")).find((f) => f.endsWith(".jsonl"))!), "utf8")
    await w.append(rec("Bash", "npm run build", "allow", "human-phone"))
    expect((await q("who-approved")).results.map((r) => r.summary)).toEqual(["npm run build", "npm test"])
    const after = fs.readFileSync(path.join(root, "index", fs.readdirSync(path.join(root, "index")).find((f) => f.endsWith(".jsonl"))!), "utf8")
    expect(after.startsWith(before)).toBe(true)
    expect(after.split("\n").filter(Boolean)).toHaveLength(6)
  })

  it("answers over 100,000 records in under 2 seconds", async () => {
    const dir = path.join(root, "big")
    fs.mkdirSync(dir)
    const lines: string[] = []
    for (let i = 1; i <= 100_000; i++)
      lines.push(
        JSON.stringify({
          seq: i,
          ts: "2026-11-01T10:00:00.000Z",
          session: `s${i % 50}`,
          project: i % 3 ? "shop" : "atlas",
          tool: i % 7 ? "Bash" : "WebFetch",
          event: "evaluate_permission",
          channel: "approver",
          outcome: i % 11 ? "allow" : "deny",
          ruleId: "r",
          decidedBy: i % 13 ? "rules" : "extreme-mode",
          risk: 10,
          ...(i % 7 ? {} : { net: true }),
          summary: `npm run step-${i}`,
        }),
      )
    fs.writeFileSync(path.join(dir, "audit-2026-11.jsonl"), `${lines.join("\n")}\n`)
    // An index already up to date with an empty log folder: the query reads only the index.
    const index = new AuditIndex({ auditDir: path.join(root, "empty-audit"), dir })
    fs.mkdirSync(path.join(root, "empty-audit"))
    for (const t of ["network", "extreme", "who-approved"] as const) {
      const started = Date.now()
      const r = await index.query(t, { redact })
      expect(Date.now() - started).toBeLessThan(2000)
      if (t === "network") expect(r.total).toBe(Math.floor(100_000 / 7))
    }
    const started = Date.now()
    const d = await index.query("denies", { project: "atlas", redact })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(d.total).toBeGreaterThan(0)
  })
})
