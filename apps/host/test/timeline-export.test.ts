// C-011, the signed timeline export: the redacted timeline, the chain head and both verifiers' results, signed; and a
// changed byte in the timeline, the head or a record fails both verifiers (Node and Windows PowerShell).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuditWriter, verifyAudit, verifyTimelineExport, type AuditEntry } from "@gatehouse/shared/audit"
import { REPO_ROOT } from "../src/bootstrap.js"
import { sessionRecords, sessionTimeline } from "../src/timeline.js"
import { stageTimelineExport, TimelineSigner } from "../src/timeline-export.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tlx-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const sealer = () => ({
  protect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x2c)),
  unprotect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x2c)),
})
const VERIFIER = path.join(REPO_ROOT, "scripts", "verify-audit.ps1")

const entry = (session: string, i: number, decidedBy: AuditEntry["verdict"]["decidedBy"]): AuditEntry => ({
  session,
  event: "human_decision",
  channel: "desktop",
  tool: "Bash",
  toolUseId: `${session}-${i}`,
  input: { command: `step ${i}` },
  verdict: { outcome: "allow", ruleId: "no-rule", reason: "ok", risk: 40, decidedBy, policyHash: "a".repeat(64) },
  latencyMs: 0,
})

let auditDir: string
let signer: TimelineSigner
beforeAll(async () => {
  auditDir = path.join(root, "audit")
  let at = new Date("2026-10-31T23:00:00Z")
  const w = new AuditWriter({ dir: auditDir, redact: (v) => v, now: () => at })
  for (let i = 0; i < 6; i++) {
    if (i === 3) at = new Date("2026-11-01T01:00:00Z")
    // Extreme approval's decisions too, which the PowerShell verifier once refused.
    await w.append(entry("s1", i, i % 2 ? "extreme-mode" : "human-desktop"))
    await w.append(entry("other", i, "rules"))
  }
  signer = new TimelineSigner({ dir: path.join(root, "data"), sealer })
})

async function staged(name: string): Promise<{ dir: string; ok: boolean; fingerprint: string }> {
  const dir = path.join(root, name)
  fs.mkdirSync(dir)
  const entries = sessionTimeline(sessionRecords(auditDir, "s1"))
  const r = await stageTimelineExport({ auditDir, session: "s1", entries, signer, verifier: VERIFIER }, dir)
  return { dir, ok: r.ok, fingerprint: r.fingerprint }
}

const ps = (dir: string) => {
  try {
    execFileSync(process.platform === "win32" ? "powershell.exe" : "pwsh", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, "verify-audit.ps1"), "-Dir", dir], { windowsHide: true, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const node = (dir: string) => verifyAudit(dir).ok && verifyTimelineExport(dir).length === 0

describe("the signed timeline export (C-011)", () => {
  it("holds the timeline, the head and both verifiers' results, which both accept", async () => {
    const { dir, ok, fingerprint } = await staged("good")
    expect(ok).toBe(true)
    expect(fingerprint).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/)
    for (const f of ["timeline.json", "timeline.sig", "timeline-key.json", "head.json", "verified.json", "verify-audit.ps1"])
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true)
    const t = JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8")) as { session: string; entries: unknown[] }
    expect(t).toMatchObject({ session: "s1" })
    expect(t.entries).toHaveLength(6)
    expect(JSON.parse(fs.readFileSync(path.join(dir, "verified.json"), "utf8"))).toMatchObject({ node: { ok: true }, powershell: { ok: true } })
    expect(node(dir)).toBe(true)
    expect(ps(dir)).toBe(true)
    // The same key next time.
    expect((await staged("again")).fingerprint).toBe(fingerprint)
  }, 120_000)

  it("fails both verifiers when one byte of the timeline, the head or a record is changed", async () => {
    const cases: Array<[string, (dir: string) => void]> = [
      ["the timeline", (d) => {
        const f = path.join(d, "timeline.json")
        fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"risk": 40', '"risk": 41'))
      }],
      ["the head", (d) => {
        const f = path.join(d, "head.json")
        const t = fs.readFileSync(f, "utf8")
        fs.writeFileSync(f, t.replace(/"hash":"(.)/, (_m, c: string) => `"hash":"${c === "a" ? "b" : "a"}`))
      }],
      ["a record", (d) => {
        const f = path.join(d, "audit-2026-11.jsonl")
        fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("step 4", "step 5"))
      }],
    ]
    for (const [what, change] of cases) {
      const { dir } = await staged(`bad-${what.replace(/\W/g, "")}`)
      change(dir)
      expect(node(dir), `Node, ${what}`).toBe(false)
      expect(ps(dir), `PowerShell, ${what}`).toBe(false)
    }
  }, 240_000)
})
