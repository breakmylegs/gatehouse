/**
 * D-074: the behaviour check, started by the owner before the Claude Code range is widened.
 *
 *   npm run behaviour:check -- --cap <dollars> [--tasks <file>] [--out <file>]
 *
 * It starts the real Host (Approver, policy, audit, organisation check) and replays each of the owner's tasks
 * (`behaviour-tasks.json` in the data folder unless --tasks names another) in a new scratch folder, in Manual mode.
 * Nobody is there to answer, so every request that would wait for a person is refused, and recorded as any refusal is.
 * The spend cap holds across all the tasks: each session is given what is left of it (the SDK's maxBudgetUsd), and a
 * task is not started once it is spent. Each task's own check (a command of the owner's, in their task file) is run in
 * its folder afterwards, with no credential in its environment. The report is written as JSON, to compare with the
 * baseline (behaviour.ts); commit it under docs/behaviour to widen the range.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import { gatehouseDataDir } from "@gatehouse/shared/node"
import { readTasks, type BehaviourReport, type TaskRecord } from "./behaviour.js"
import { createHost } from "./bootstrap.js"
import { withoutCredentials } from "./codehouse-action.js"

const { values } = parseArgs({ options: { cap: { type: "string" }, tasks: { type: "string" }, out: { type: "string" } } })
const cap = Number(values.cap)
if (!values.cap || !Number.isFinite(cap) || cap <= 0 || cap > 100) {
  console.error("Usage: npm run behaviour:check -- --cap <dollars, up to 100> [--tasks <file>] [--out <file>]")
  process.exit(2)
}
const tasksFile = values.tasks ?? path.join(gatehouseDataDir(process.env), "behaviour-tasks.json")
let tasks: ReturnType<typeof readTasks> = []
try {
  tasks = readTasks(tasksFile)
} catch {
  // Missing or not JSON: said below.
}
if (!tasks.length) {
  console.error(`No tasks in ${tasksFile}. Each is { "id", "prompt", "files": { "path": "content" }, "check": "command" }.`)
  process.exit(2)
}

const check = (command: string, cwd: string) =>
  new Promise<boolean>((resolve) =>
    execFile(command, { cwd, shell: true, windowsHide: true, timeout: 300_000, env: withoutCredentials(process.env) } as never, (e) => resolve(!e)),
  )

const host = createHost({ log: (l) => console.error(`  [host] ${l}`) })
// Unattended: whatever would wait for a person is refused, and recorded by the broker as any refusal is.
host.app.broker.on("created", (v) =>
  host.app.broker.resolve(v.request.id, { kind: "decision", decision: "deny", message: "A behaviour check runs unattended, so this was refused." }, "desktop"),
)

const report: BehaviourReport = { v: 1, claudeCode: "unknown", at: new Date().toISOString(), capUsd: cap, tasks: {} }
let spent = 0
const scratch: string[] = []
try {
  await host.start()
  for (const t of tasks) {
    if (spent >= cap) {
      report.tasks[t.id] = { tools: [], decisions: [], costUsd: 0, notRun: "the spend cap was reached" }
      continue
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `codeh-behaviour-${t.id}-`))
    scratch.push(dir)
    for (const [rel, text] of Object.entries(t.files ?? {})) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), text)
    }
    const rec: TaskRecord = { tools: [], decisions: [], costUsd: 0 }
    const toolOf = new Map<string, string>()
    const session = await host.app.manager.start({ cwd: dir, mode: "default", maxBudgetUsd: Math.max(0.01, cap - spent) })
    const done = new Promise<void>((resolve) => {
      session.on("message", (raw) => {
        const m = raw as unknown as { type: string; subtype?: string; total_cost_usd?: number; claude_code_version?: string; message?: { content?: Array<{ type: string; id?: string; name?: string }> } }
        if (m.type === "system" && m.subtype === "init" && m.claude_code_version) report.claudeCode = m.claude_code_version
        if (m.type === "assistant")
          for (const b of m.message?.content ?? [])
            if (b.type === "tool_use" && b.name) {
              rec.tools.push(b.name)
              if (b.id) toolOf.set(b.id, b.name)
            }
        if (m.type === "result") {
          rec.costUsd = m.total_cost_usd ?? 0
          if (m.subtype && m.subtype !== "success") rec.notRun = `it stopped: ${m.subtype}`
          resolve()
        }
      })
    })
    session.on("event", (e: { type: string; data: { toolUseId?: string; outcome?: "allow" | "deny" | "escalate"; ruleId?: string } }) => {
      if (e.type === "decision" && e.data.outcome && e.data.ruleId)
        rec.decisions.push({ tool: toolOf.get(e.data.toolUseId ?? "") ?? "unknown", outcome: e.data.outcome, ruleId: e.data.ruleId })
    })
    console.log(`Task ${t.id} in ${dir}`)
    session.prompt(t.prompt)
    await done
    spent += rec.costUsd
    if (t.check && !rec.notRun) rec.passed = await check(t.check, dir)
    report.tasks[t.id] = rec
    console.log(`  ${rec.tools.length} call(s), ${rec.decisions.filter((d) => d.outcome !== "allow").length} held or denied, $${rec.costUsd.toFixed(4)}${rec.passed === undefined ? "" : rec.passed ? ", check passed" : ", check FAILED"}`)
  }
  const out = values.out ?? path.join("docs", "behaviour", `${report.claudeCode}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(`${out}.tmp`, `${JSON.stringify(report, null, 2)}\n`)
  fs.renameSync(`${out}.tmp`, out)
  console.log(`\nClaude Code ${report.claudeCode}: ${Object.keys(report.tasks).length} task(s), $${spent.toFixed(4)} of $${cap}. Written to ${out}.`)
} catch (e) {
  console.error(`\n${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await host.stop().catch(() => undefined)
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}
