// C-012, the policy dry run: a Plan-mode plan's steps judged by the live policy, counted as allow, ask and refuse,
// labelled as an estimate; and nothing in it is run.
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { dryRunPlan, estimateWords, planCalls } from "../src/plan-dry-run.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
}, 60000)
afterAll(() => s.stop())

const PLAN = (marker: string) => `## Plan

1. Update \`src/a.ts\` to read the setting.
2. Create \`src/config.ts\` with the defaults.
3. Run the tests:

\`\`\`bash
npm test
node -e "require('fs').writeFileSync('${marker}', 'ran')"
\`\`\`

4. Then \`git push --force origin main\` so the branch is up to date.
5. Clean up with \`rm -rf ${marker}-dir\`.

\`\`\`ts
const notACommand = 1
\`\`\`
`

describe("the policy dry run (C-012)", () => {
  it("reads the calls a plan names, from code blocks, backticks and the files it will change", () => {
    const calls = planCalls(PLAN("m")).map((c) => [c.toolName, (c.input as { command?: string; file_path?: string }).command ?? (c.input as { file_path: string }).file_path])
    expect(calls).toEqual([
      ["Bash", "npm test"],
      ["Bash", "node -e \"require('fs').writeFileSync('m', 'ran')\""],
      ["Bash", "git push --force origin main"],
      ["Bash", "rm -rf m-dir"],
      ["Edit", "src/a.ts"],
      ["Write", "src/config.ts"],
    ])
  })

  it("counts what the rules now would do, labelled as an estimate, and runs nothing", async () => {
    const marker = "DRY-RUN-RAN.txt"
    fs.mkdirSync(path.join(s.repo, `${marker}-dir`))
    const before = s.records().length
    const est = await dryRunPlan(PLAN(marker), s.repo, s.deps.engine)
    expect(est.allow + est.escalate + est.deny).toBe(6)
    expect(est.calls.find((c) => c.text.startsWith("git push"))?.outcome).not.toBe("allow")
    expect(estimateWords(est)).toMatch(/^An estimate, from the 6 steps the plan names, against your rules now: \d+ would be allowed, \d+ would ask you, \d+ would be refused\./)
    // Nothing ran: the file the plan would write is not there, the folder it would delete still is, and no file the
    // plan would change was touched; nothing was recorded as a decision.
    expect(fs.existsSync(path.join(s.repo, marker))).toBe(false)
    expect(fs.existsSync(path.join(s.repo, `${marker}-dir`))).toBe(true)
    expect(fs.existsSync(path.join(s.repo, "src", "config.ts"))).toBe(false)
    expect(s.git("status", "--porcelain")).not.toMatch(/src\/a\.ts/)
    expect(s.records().length).toBe(before)
  })

  it("shows the estimate on the plan's card and records its counts with the decision", async () => {
    s.sdk.turn = async (api) => {
      await api.callTool("ExitPlanMode", { plan: PLAN("x") })
    }
    const session = await s.manager.start({ cwd: s.repo, mode: "plan" })
    session.prompt("plan it")
    await s.waitForPending()
    const card = s.broker.list()[0]!
    expect(card.request.verdict.reason).toMatch(/An estimate, from the 6 steps the plan names/)
    s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
    await expect
      .poll(() => s.records().find((r) => r.event === "plan_decision" && r.session === session.id)?.inputJson ?? "")
      .toMatch(/"estimate":\{"allow":\d+,"deny":\d+,"escalate":\d+\}|"estimate":\{"allow":\d+,"escalate":\d+,"deny":\d+\}/)
    await session.close()
  })
})
