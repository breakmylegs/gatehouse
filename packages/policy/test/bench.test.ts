import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PolicyEngine } from "../src/engine.js"
import { PwshWorker } from "../src/pwsh.js"
import { fwd, makeFixture, testPolicy, type Fixture } from "./helpers.js"

let fx: Fixture
let pwsh: PwshWorker
let engine: PolicyEngine

beforeAll(async () => {
  fx = makeFixture()
  pwsh = new PwshWorker()
  await pwsh.start()
  const policy = testPolicy(fx)
  engine = new PolicyEngine({ getPolicy: () => policy, pwsh })
  // Let the freshly started worker finish warming up before anything is timed.
  for (let i = 0; i < 20; i++) await pwsh.parse(`Write-Output warm${i}`)
}, 60000)
afterAll(() => {
  pwsh.close()
  fx.dispose()
})

/** A different PowerShell text on every round, so each call really reaches the worker. */
const typical = (round: number) => [
  { toolName: "Bash", input: { command: "git status" } },
  { toolName: "Bash", input: { command: "git diff HEAD~1 -- src/a.ts" } },
  { toolName: "Bash", input: { command: "git log --oneline -5" } },
  { toolName: "Bash", input: { command: "npm test" } },
  { toolName: "Bash", input: { command: "git status && git diff | head" } },
  { toolName: "Bash", input: { command: "npm install lodash" } },
  { toolName: "Read", input: { file_path: "src/a.ts" } },
  { toolName: "Edit", input: { file_path: "src/a.ts" } },
  { toolName: "Write", input: { file_path: "docs/new.md" } },
  { toolName: "Grep", input: { pattern: "x", path: "src" } },
  { toolName: "PowerShell", input: { command: `Get-ChildItem -Recurse -Depth ${round}` } },
  { toolName: "PowerShell", input: { command: `Get-Content README.md -TotalCount ${round + 1}` } },
]

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

async function measure(rounds: number, uniquePowerShell: boolean) {
  const ctx = { cwd: fwd(fx.ws) }
  const times: number[] = []
  for (let round = 0; round < rounds; round++) {
    for (const call of typical(uniquePowerShell ? 1000 + round : 0)) {
      const t0 = performance.now()
      await engine.evaluate(call, ctx)
      times.push(performance.now() - t0)
    }
  }
  times.sort((a, b) => a - b)
  return { times, p50: percentile(times, 0.5), p95: percentile(times, 0.95), max: times[times.length - 1] ?? 0 }
}

describe("latency (spec: p95 under 20 ms for typical commands, first pwsh start excluded)", () => {
  it("is under 20 ms at p95 when every PowerShell command is new to the worker", async () => {
    const r = await measure(40, true)
    console.log(
      `uncached PowerShell mix, ${r.times.length} calls: p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, max ${r.max.toFixed(2)} ms`,
    )
    expect(r.times.length).toBe(480)
    expect(r.p95).toBeLessThan(20)
  })

  it("is under 20 ms at p95 for repeated commands too (cache hits)", async () => {
    const r = await measure(40, false)
    console.log(
      `repeated mix, ${r.times.length} calls: p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, max ${r.max.toFixed(2)} ms`,
    )
    expect(r.p95).toBeLessThan(20)
  })
})
