// E-097: the crash bundle's preview is exactly what the zip holds; a secret seeded in host.log is masked; audit
// records go in as kind and outcome only, settings as key names only; saving is audited. The secrets here are put
// together at run time, so this file holds none.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { AuditWriter } from "@gatehouse/shared/audit"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SafeZip } from "../src/chat/import/zip.js"
import { keyNames, registerCrashBundleRoutes } from "../src/crash-bundle.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-bundle-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const secret = () => ["sk-ant-", "api03-", crypto.randomBytes(24).toString("hex")].join("")

async function setup() {
  const key = secret()
  const logPath = path.join(dir, "host.log")
  fs.writeFileSync(logPath, `2026-11-18T08:00:00Z started\n2026-11-18T08:01:00Z oops, a key: ${key}\n2026-11-18T08:02:00Z Claude Code process exited with code 3221226505\n`)
  const auditDir = path.join(dir, "audit")
  const writer = new AuditWriter({ dir: auditDir, redact: (x) => x })
  await writer.append({ session: "s1", event: "tool_decision", channel: "desktop", tool: "Bash", input: { command: "echo the prompt text" }, verdict: { outcome: "allow", ruleId: "safe-shell", reason: "a reason with words", risk: 0, decidedBy: "rules", policyHash: "" }, latencyMs: 1 })
  const recorded: Array<Record<string, unknown>> = []
  const app = Fastify()
  const downloads = path.join(dir, "Downloads")
  registerCrashBundleRoutes(app, {
    sources: {
      logPath,
      auditDir,
      version: "2.0.441",
      doctorReport: async () => "Doctor: all ok",
      settings: () => ({ redactTerms: ["Client Name"], checkpoints: { beforeEscalation: true } }),
      redactTerms: () => ["Client Name"],
    },
    downloads,
    record: async (input) => (recorded.push(input), true),
  })
  return { app, key, downloads, recorded }
}

describe("the crash bundle (E-097)", () => {
  it("saves exactly what the preview showed, masks a seeded secret, and leaves out inputs and values", async () => {
    const s = await setup()
    const preview = (await s.app.inject({ method: "POST", url: "/api/crash-bundle/preview" })).json() as { id: string; files: Record<string, string> }
    expect(Object.keys(preview.files).sort()).toEqual(["audit-outcomes.json", "crash-codes.json", "doctor.txt", "host.log", "settings-keys.json", "version.json"])
    expect(preview.files["host.log"]).not.toContain(s.key)
    expect(preview.files["host.log"]).toContain("[REDACTED:")
    const all = JSON.stringify(preview.files)
    expect(all).not.toContain("echo the prompt text")
    expect(all).not.toContain("a reason with words")
    expect(all).not.toContain("Client Name")
    expect(JSON.parse(preview.files["audit-outcomes.json"]!)).toEqual([expect.objectContaining({ event: "tool_decision", outcome: "allow", rule: "safe-shell" })])
    expect(JSON.parse(preview.files["crash-codes.json"]!)).toEqual([expect.objectContaining({ hex: "0xC0000409", times: 1 })])
    expect(JSON.parse(preview.files["settings-keys.json"]!)).toEqual(["checkpoints.beforeEscalation", "redactTerms"])

    const saved = (await s.app.inject({ method: "POST", url: "/api/crash-bundle", payload: { id: preview.id } })).json() as { file: string }
    expect(path.dirname(saved.file)).toBe(s.downloads)
    const zip = await SafeZip.open(saved.file)
    try {
      const inZip: Record<string, string> = {}
      for (const e of zip.entries) inZip[e.name] = await zip.text(e)
      expect(inZip).toEqual(preview.files)
    } finally {
      await zip.close()
    }
    expect(s.recorded).toEqual([expect.objectContaining({ file: path.basename(saved.file), files: Object.keys(preview.files) })])
    // A preview is used once.
    expect((await s.app.inject({ method: "POST", url: "/api/crash-bundle", payload: { id: preview.id } })).statusCode).toBe(409)
    await s.app.close()
  })

  it("names settings' keys and never their values", () => {
    expect(keyNames({ a: { b: 1, c: "secret" }, d: [1, 2] })).toEqual(["a.b", "a.c", "d"])
  })
})
