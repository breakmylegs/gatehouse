// D-049: performance budgets. BenchmarkDotNet's and Vitest's (tinybench) results are read in milliseconds; a budget
// with no matching benchmark is said, not passed; and the tool is found from the project's own files.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { checkBudgets, detectTool, meansOf } from "../src/budgets.js"

describe("performance budgets (D-049)", () => {
  it("reads BenchmarkDotNet's nanoseconds and Vitest's milliseconds, and never passes a budget it could not measure", () => {
    const bdn = meansOf("benchmarkdotnet", { Benchmarks: [{ Method: "Parse", Statistics: { Mean: 2_500_000 } }] })
    expect(bdn.get("Parse")).toBe(2.5)
    const tiny = meansOf("tinybench", { files: [{ groups: [{ benchmarks: [{ name: "sort", mean: 0.75 }] }] }] })
    expect(tiny.get("sort")).toBe(0.75)
    const budgets = [{ name: "Parse", maxMeanMs: 2, touched: (f: string) => f.startsWith("src/") }]
    expect(checkBudgets(budgets, ["src/a.cs"], bdn)[0]).toMatchObject({ ok: false, meanMs: 2.5 })
    expect(checkBudgets(budgets, ["src/a.cs"], new Map())[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/could not be checked/) })
    expect(checkBudgets(budgets, ["docs/a.md"], bdn)).toEqual([])
  })

  it("finds tinybench or BenchmarkDotNet from the project's own files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-bud-"))
    try {
      expect(detectTool(dir)).toBeUndefined()
      fs.mkdirSync(path.join(dir, "bench"))
      fs.writeFileSync(path.join(dir, "bench", "Bench.csproj"), '<Project><ItemGroup><PackageReference Include="BenchmarkDotNet" Version="0.14.0" /></ItemGroup></Project>')
      expect(detectTool(dir)).toMatchObject({ tool: "benchmarkdotnet", command: expect.stringContaining("Bench.csproj") })
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { tinybench: "2.9.0" } }))
      expect(detectTool(dir)?.tool).toBe("tinybench")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
