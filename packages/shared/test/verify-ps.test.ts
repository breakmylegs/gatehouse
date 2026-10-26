import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuditWriter, listAuditFiles, headPath, verifyAudit } from "../src/audit/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(here, "../../../scripts/verify-audit.ps1")

let root: string
let n = 0
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-verify-ps-"))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

interface PsResult {
  ok: boolean
  records: number
  files: number
  problems: { file: string; line: number; reason: string }[]
}

function runPs(dir: string): { code: number; result: PsResult } {
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", SCRIPT, "-Dir", dir, "-Json"], { encoding: "utf8" })
  return { code: r.status ?? -1, result: JSON.parse(r.stdout) as PsResult }
}

const where = (problems: { file: string; line: number }[]) => problems.map((p) => `${p.file}:${p.line}`).sort()

function agree(dir: string): { ok: boolean; problems: string[] } {
  const node = verifyAudit(dir)
  const { code, result } = runPs(dir)
  expect(result.ok).toBe(node.ok)
  expect(code).toBe(node.ok ? 0 : 1)
  expect(result.records).toBe(node.records)
  expect(result.files).toBe(node.files)
  expect(where(result.problems)).toEqual(where(node.problems))
  return { ok: node.ok, problems: where(node.problems) }
}

async function build(): Promise<{ dir: string; file: string }> {
  const dir = path.join(root, `d${n++}`)
  let clock = new Date("2026-05-31T23:59:50Z")
  const w = new AuditWriter({ dir, redact: (v) => v, now: () => clock })
  const strings = [
    "git status",
    'quote " backslash \\ slash / <tag> & \'single\'',
    "caf\u00e9 \u65e5\u672c\u8a9e \ud83d\ude00 emoji",
    "control \u0001 \u001f tab\t newline\n return\r",
    "x".repeat(5000),
  ]
  for (const [i, command] of strings.entries()) {
    if (i === 3) clock = new Date("2026-06-01T00:00:05Z")
    await w.append({
      session: `s\u00e9ssion-${i}`,
      event: "evaluate_permission",
      channel: i % 2 === 0 ? "approver" : "desktop",
      tool: "Bash",
      cwd: "C:/dev/p\u00e9",
      input: { command, n: 1.5, nested: { b: [1, 2, { z: null }], a: true } },
      verdict: {
        outcome: "escalate",
        ruleId: "no-rule",
        reason: command.slice(0, 40),
        risk: 50,
        decidedBy: "rules",
        policyHash: "a".repeat(64),
        segments: [{ text: command.slice(0, 60), ruleId: "no-rule", outcome: "escalate" }],
      },
      latencyMs: 3,
      judgeRationale: i === 2 ? "because \u00e9" : undefined,
    })
  }
  const dir2 = dir
  return { dir: dir2, file: path.join(dir, listAuditFiles(dir)[0] as string) }
}

describe("scripts/verify-audit.ps1 agrees with the Node verifier", () => {
  it("accepts an intact log with unicode, control characters, nested input and a month change", async () => {
    const { dir } = await build()
    const r = agree(dir)
    expect(r.ok).toBe(true)
    expect(runPs(dir).result).toMatchObject({ ok: true, records: 5, files: 2 })
  })

  it("accepts an empty or missing folder", () => {
    const dir = path.join(root, `empty${n++}`)
    expect(agree(dir).ok).toBe(true)
    fs.mkdirSync(dir)
    expect(agree(dir).ok).toBe(true)
  })

  const tamper: [string, (dir: string, file: string) => void][] = [
    ["an edited field", (_d, f) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"risk":50', '"risk":10'))],
    ["a deleted record", (_d, f) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").filter((_l, i) => i !== 1).join("\n"))],
    ["removal from the end", (d, f) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").slice(0, 2).join("\n") + "\n")],
    ["a missing head.json", (d) => fs.rmSync(headPath(d))],
    ["bad json", (_d, f) => fs.appendFileSync(f, "{oops\n")],
    ["a blank line", (_d, f) => fs.appendFileSync(f, "\n\n")],
    ["a torn final line", (_d, f) => fs.appendFileSync(f, '{"v":1,"seq"')],
    ["an invalid record", (_d, f) => fs.appendFileSync(f, '{"v":1}\n')],
    ["a swapped pair", (_d, f) => {
      const l = fs.readFileSync(f, "utf8").split("\n")
      ;[l[0], l[1]] = [l[1] as string, l[0] as string]
      fs.writeFileSync(f, l.join("\n"))
    }],
    ["a record in the wrong month file", (d, f) => fs.renameSync(path.join(d, "audit-2026-06.jsonl"), path.join(d, "audit-2026-07.jsonl"))],
  ]
  for (const [name, mutate] of tamper) {
    it(`flags ${name} exactly where the Node verifier does`, async () => {
      const { dir, file } = await build()
      mutate(dir, file)
      const r = agree(dir)
      expect(r.ok).toBe(false)
      expect(r.problems.length).toBeGreaterThan(0)
    })
  }
})
