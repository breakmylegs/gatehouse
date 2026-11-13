// D-029, audit anchoring: the chain's head signed and kept apart from the log; rewriting an old record, even with every
// hash after it recomputed, fails both verifiers (Node and Windows PowerShell) against the anchor; anchor_signed recorded.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { AuditWriter, GENESIS_HASH, hashRecord, verifyAudit, type AuditEntry } from "@gatehouse/shared/audit"
import { AnchorService } from "../src/anchors.js"
import { REPO_ROOT } from "../src/bootstrap.js"
import { TimelineSigner } from "../src/timeline-export.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-anchor-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const sealer = () => ({
  protect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)),
  unprotect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)),
})
const VERIFIER = path.join(REPO_ROOT, "scripts", "verify-audit.ps1")
const ps = (dir: string): boolean => {
  try {
    execFileSync(process.platform === "win32" ? "powershell.exe" : "pwsh", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", VERIFIER, "-Dir", dir], { windowsHide: true, stdio: "ignore", timeout: 120_000 })
    return true
  } catch {
    return false
  }
}

const entry = (i: number): AuditEntry => ({
  session: "s1",
  event: "human_decision",
  channel: "desktop",
  tool: "Bash",
  input: { command: `step ${i}` },
  verdict: { outcome: "allow", ruleId: "no-rule", reason: "ok", risk: 40, decidedBy: "human-desktop", policyHash: "a".repeat(64) },
  latencyMs: 0,
})

/** Rewrites one record and recomputes every hash after it and head.json: the chain alone then looks intact. */
function rewriteAndRechain(auditDir: string, seq: number, command: string): void {
  const file = fs.readdirSync(auditDir).find((f) => f.endsWith(".jsonl"))!
  const p = path.join(auditDir, file)
  let prev = GENESIS_HASH
  const lines = fs
    .readFileSync(p, "utf8")
    .trimEnd()
    .split("\n")
    .map((l) => {
      const r = JSON.parse(l) as Record<string, unknown>
      if (r.seq === seq) r.inputJson = JSON.stringify({ command })
      r.prevHash = prev
      const { hash: _h, ...body } = r
      r.hash = hashRecord(body as never)
      prev = r.hash as string
      return JSON.stringify(r)
    })
  fs.writeFileSync(p, `${lines.join("\n")}\n`)
  const head = JSON.parse(fs.readFileSync(path.join(auditDir, "head.json"), "utf8")) as Record<string, unknown>
  fs.writeFileSync(path.join(auditDir, "head.json"), JSON.stringify({ ...head, hash: prev }))
}

describe("audit anchoring (D-029)", () => {
  it("anchors the head, records it, and a rewritten old record then fails both verifiers", async () => {
    const auditDir = path.join(root, "audit")
    const anchorsDir = path.join(root, "anchors")
    const w = new AuditWriter({ dir: auditDir, redact: (v) => v, now: () => new Date("2026-11-11T10:00:00Z") })
    for (let i = 0; i < 4; i++) await w.append(entry(i))
    const recorded: Array<Record<string, unknown>> = []
    const git = vi.fn(async () => "")
    const service = new AnchorService({
      dir: anchorsDir,
      auditDir,
      signer: new TimelineSigner({ dir: path.join(root, "data"), sealer, file: "anchor-key.sealed" }),
      audit: { record: async (e) => (recorded.push(e as never), true) },
      log: () => undefined,
      git,
      now: () => new Date("2026-11-11T10:05:00Z"),
    })
    const a = await service.anchor("on demand")
    expect(a).toMatchObject({ seq: 4, signer: "local", strength: "weaker" })
    expect(recorded[0]).toMatchObject({ event: "anchor_signed", input: { seq: 4, strength: "weaker" } })
    // Kept in a repository of its own, with a tag per anchor.
    expect(git.mock.calls.map((c) => (c as unknown as [string, string[]])[1][0])).toEqual(["init", "add", "commit", "tag"])
    // The same head again is not anchored twice.
    expect(await service.anchor("daily")).toEqual(a)
    expect(service.list()).toHaveLength(1)

    expect(verifyAudit(auditDir, { anchorsDir })).toMatchObject({ ok: true, anchors: 1 })
    expect(ps(auditDir)).toBe(true)

    rewriteAndRechain(auditDir, 2, "curl https://drop.test")
    // Without the anchor, the rewritten chain passes; with it, both verifiers say which record changed.
    expect(verifyAudit(auditDir).ok).toBe(true)
    const r = verifyAudit(auditDir, { anchorsDir })
    expect(r.ok).toBe(false)
    expect(r.problems.map((p) => p.reason)).toEqual(["record 4 was changed after it was anchored on 2026-11-11T10:05:00.000Z"])
    expect(ps(auditDir)).toBe(false)
  })

  it("fails both verifiers when an anchor itself is changed", async () => {
    const dir = path.join(root, "two")
    const auditDir = path.join(dir, "audit")
    const anchorsDir = path.join(dir, "anchors")
    const w = new AuditWriter({ dir: auditDir, redact: (v) => v, now: () => new Date("2026-11-11T10:00:00Z") })
    for (let i = 0; i < 3; i++) await w.append(entry(i))
    const service = new AnchorService({
      dir: anchorsDir,
      auditDir,
      signer: new TimelineSigner({ dir: path.join(dir, "data"), sealer, file: "anchor-key.sealed" }),
      audit: { record: async () => true },
      log: () => undefined,
      git: async () => "",
    })
    await service.anchor("daily")
    const file = path.join(anchorsDir, fs.readdirSync(anchorsDir).find((f) => f.startsWith("anchor-"))!)
    const anchor = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    fs.writeFileSync(file, JSON.stringify({ ...anchor, ts: "2026-01-01T00:00:00.000Z" }))
    expect(verifyAudit(auditDir, { anchorsDir }).problems.map((p) => p.reason)).toEqual([
      "the anchor's signature does not verify, so the anchor was changed",
    ])
    expect(ps(auditDir)).toBe(false)
  })
})
