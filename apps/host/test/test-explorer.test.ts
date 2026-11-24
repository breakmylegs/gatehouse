// G38: the test explorer. Tests are listed per file by reading them, for Vitest, Jest, pytest and dotnet; a run uses
// the project's own runner (never a download, never a shell), is audited first and refused by the kill switch, and
// its report gives each failure with its line.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  commandFor,
  detectRunners,
  discover,
  failureLine,
  parseCsTests,
  parseJsTests,
  parsePyTests,
  parseReport,
  TestExplorer,
  TestRunError,
} from "../src/test-explorer.js"

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "g38-"))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** A project with a stand-in vitest: its program writes the report it is given, then exits as asked. */
function project(name: string, report: unknown, o: { exit?: number; sleepMs?: number } = {}): string {
  const root = path.join(dir, name)
  fs.mkdirSync(path.join(root, "node_modules", "vitest"), { recursive: true })
  fs.mkdirSync(path.join(root, "tests"), { recursive: true })
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { vitest: "4.0.0" } }))
  fs.writeFileSync(path.join(root, "node_modules", "vitest", "package.json"), JSON.stringify({ name: "vitest", bin: { vitest: "./cli.cjs" } }))
  fs.writeFileSync(
    path.join(root, "node_modules", "vitest", "cli.cjs"),
    `const fs = require("fs")
const out = process.argv.find((a) => a.startsWith("--outputFile=")).slice(13)
fs.writeFileSync(require("path").join(process.cwd(), "args.json"), JSON.stringify(process.argv.slice(2)))
setTimeout(() => { fs.writeFileSync(out, ${JSON.stringify(JSON.stringify(report))}); process.exit(${o.exit ?? 0}) }, ${o.sleepMs ?? 0})
`,
  )
  fs.writeFileSync(path.join(root, "tests", "math.test.ts"), `describe("math", () => {\n  it("adds", () => {})\n  it("subtracts", () => {})\n})\n`)
  return root
}

function explorer(o: { killed?: boolean; recordOk?: boolean; timeoutMs?: number } = {}) {
  const records: Array<Record<string, unknown>> = []
  const stopped: number[] = []
  const t = new TestExplorer({
    audit: {
      record: async (r: Record<string, unknown>) => {
        records.push(r)
        return o.recordOk ?? true
      },
    } as never,
    killed: () => o.killed === true,
    policyHash: () => "h",
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    stopTree: (pid) => {
      stopped.push(pid)
      process.kill(pid)
    },
  })
  return { t, records, stopped }
}

const vitestReport = (root: string) => ({
  testResults: [
    {
      name: path.join(root, "tests", "math.test.ts"),
      assertionResults: [
        { ancestorTitles: ["math"], title: "adds", status: "passed", failureMessages: [] },
        {
          ancestorTitles: ["math"],
          title: "subtracts",
          status: "failed",
          failureMessages: ["AssertionError: expected 1 to be 2\n    at " + path.join(root, "tests", "math.test.ts") + ":3:31"],
        },
      ],
    },
  ],
})

describe("listing tests by reading them (G38)", () => {
  it("names JavaScript tests with their suites and lines, skipped and only ones too", () => {
    const text = `import { it } from "vitest"\ndescribe("cart", () => {\n  it("adds an item", () => {})\n  describe("totals", () => {\n    test.skip('rounds \\'up\\'', () => {})\n  })\n  it.only("empties", () => {})\n})\ntest("alone", () => {})\n`
    expect(parseJsTests(text)).toEqual([
      { name: "cart > adds an item", line: 3 },
      { name: "cart > totals > rounds 'up'", line: 5 },
      { name: "cart > empties", line: 7 },
      { name: "alone", line: 9 },
    ])
  })

  it("names pytest's tests, in a class as Class::test, and .NET's marked methods", () => {
    expect(parsePyTests(`import x\n\ndef test_one():\n    pass\n\nclass TestCart:\n    def test_add(self):\n        pass\n\ndef helper():\n    pass\n\nasync def test_two():\n    pass\n`)).toEqual([
      { name: "test_one", line: 3 },
      { name: "TestCart::test_add", line: 7 },
      { name: "test_two", line: 13 },
    ])
    expect(parseCsTests(`public class CartTests {\n  [Fact]\n  public void Adds() {}\n  [Theory]\n  [InlineData(1)]\n  public async Task Rounds(int n) {}\n  public void NotATest() {}\n  [Test] public void Empties() {}\n}\n`)).toEqual([
      { name: "Adds", line: 3 },
      { name: "Rounds", line: 6 },
      { name: "Empties", line: 8 },
    ])
  })

  it("finds the runners a project uses and its test files, leaving out installed packages", () => {
    const root = project("detect", {})
    fs.writeFileSync(path.join(root, "pytest.ini"), "[pytest]\n")
    fs.writeFileSync(path.join(root, "test_api.py"), "def test_get():\n    pass\n")
    fs.writeFileSync(path.join(root, "Shop.Tests.csproj"), `<Project><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>`)
    fs.writeFileSync(path.join(root, "CartTests.cs"), "class C { [Fact] public void Adds() {} }")
    const files = ["package.json", "tests/math.test.ts", "node_modules/vitest/x.test.js", "test_api.py", "Shop.Tests.csproj", "CartTests.cs", "Program.cs"]
    fs.writeFileSync(path.join(root, "Program.cs"), "class P {}")
    expect(detectRunners(root, files).sort()).toEqual(["dotnet", "pytest", "vitest"])
    expect(discover(root, files)).toEqual([
      { file: "tests/math.test.ts", runner: "vitest", tests: [{ name: "math > adds", line: 2 }, { name: "math > subtracts", line: 3 }] },
      { file: "test_api.py", runner: "pytest", tests: [{ name: "test_get", line: 1 }] },
      { file: "CartTests.cs", runner: "dotnet", tests: [{ name: "Adds", line: 1 }] },
    ])
    expect(detectRunners(path.join(dir, "nothing-here"))).toEqual([])
  })
})

describe("the runner's command (G38)", () => {
  it("runs the project's own runner with this Node, never npx, and refuses one that is not installed", () => {
    const root = project("cmd", {})
    const c = commandFor("vitest", root, "/out", { file: "tests/math.test.ts", name: "math > adds (1+1)" })
    expect(c.file).toBe(process.execPath)
    expect(c.args[0]).toBe(path.join(root, "node_modules", "vitest", "cli.cjs"))
    expect(c.args).toEqual(expect.arrayContaining(["run", "tests/math.test.ts", "-t", "math adds \\(1\\+1\\)", "--reporter=json"]))
    expect(c.args.join(" ")).not.toMatch(/npx/)
    expect(() => commandFor("jest", root, "/out", {})).toThrow(TestRunError)
    expect(commandFor("pytest", root, "/out", { file: "test_api.py", name: "TestA::test_b" }, { python: "py" })).toMatchObject({
      file: "py",
      args: ["-m", "pytest", "test_api.py::TestA::test_b", "-q", expect.stringMatching(/^--junitxml=/)],
    })
    expect(commandFor("dotnet", root, "/out", { name: "Adds" }).args).toEqual(expect.arrayContaining(["test", "--filter", "Name=Adds"]))
  })
})

describe("reading a runner's report (G38)", () => {
  it("gives Vitest's and Jest's results, a failure with the line its stack names", () => {
    const root = path.join(dir, "r")
    const out = parseReport("vitest", JSON.stringify(vitestReport(root)), root)
    expect(out).toEqual([
      { file: "tests/math.test.ts", name: "math > adds", status: "passed" },
      { file: "tests/math.test.ts", name: "math > subtracts", status: "failed", message: expect.stringContaining("expected 1 to be 2"), line: 3 },
    ])
    expect(parseReport("jest", "not json", root)).toEqual([])
    const broken = parseReport("jest", JSON.stringify({ testResults: [{ name: path.join(root, "a.test.js"), message: "\u001b[31mSyntaxError\u001b[39m", assertionResults: [] }] }), root)
    expect(broken).toEqual([{ file: "a.test.js", name: "(the file did not load)", status: "failed", message: "SyntaxError" }])
  })

  it("gives pytest's and dotnet's results from their XML, text unescaped", () => {
    const xml = `<testsuite><testcase classname="tests.test_api.TestCart" name="test_add" file="tests/test_api.py" line="6"><failure message="assert 1 == 2">tests/test_api.py:9: AssertionError &lt;here&gt;</failure></testcase><testcase classname="tests.test_api" name="test_ok" file="tests/test_api.py" line="1"/><testcase classname="tests.test_api" name="test_skip" file="tests/test_api.py" line="3"><skipped/></testcase></testsuite>`
    expect(parseReport("pytest", xml, "/p")).toEqual([
      { file: "tests/test_api.py", name: "TestCart::test_add", status: "failed", message: "assert 1 == 2\ntests/test_api.py:9: AssertionError <here>", line: 9 },
      { file: "tests/test_api.py", name: "test_ok", status: "passed", line: 2 },
      { file: "tests/test_api.py", name: "test_skip", status: "skipped", line: 4 },
    ])
    const trx = `<TestRun><Results><UnitTestResult testName="Shop.CartTests.Adds" outcome="Failed"><Output><ErrorInfo><Message>Expected 2</Message><StackTrace>at Shop.CartTests.Adds() in C:\\p\\CartTests.cs:line 14</StackTrace></ErrorInfo></Output></UnitTestResult><UnitTestResult testName="Shop.CartTests.Empties" outcome="Passed" /></Results></TestRun>`
    const files = [{ file: "CartTests.cs", runner: "dotnet" as const, tests: [{ name: "Adds", line: 12 }, { name: "Empties", line: 20 }] }]
    expect(parseReport("dotnet", trx, "/p", files)).toEqual([
      { file: "CartTests.cs", name: "Adds", status: "failed", message: expect.stringContaining("Expected 2"), line: 14 },
      { file: "CartTests.cs", name: "Empties", status: "passed", line: 20 },
    ])
    expect(failureLine("at x (C:/p/a.test.ts:12:3)", "a.test.ts")).toBe(12)
    expect(failureLine("at x (C:/p/other.ts:12:3)", "a.test.ts")).toBeUndefined()
  })
})

describe("a run (G38)", () => {
  it("is audited first, runs the project's runner for the file and test, and gives the results", async () => {
    const root = project("run", vitestReport(path.join(dir, "run")), { exit: 1 })
    const { t, records } = explorer()
    const o = await t.run("s1", root, "vitest", { file: "tests/math.test.ts", name: "math > subtracts" })
    expect(records).toEqual([
      expect.objectContaining({ session: "s1", event: "tests_run", channel: "desktop", input: { runner: "vitest", folder: root, file: "tests/math.test.ts", test: "math > subtracts" } }),
    ])
    expect(JSON.parse(fs.readFileSync(path.join(root, "args.json"), "utf8"))).toEqual(expect.arrayContaining(["run", "tests/math.test.ts", "-t", "math subtracts"]))
    expect(o.exitCode).toBe(1)
    expect(o.results.map((r) => [r.name, r.status, r.line])).toEqual([
      ["math > adds", "passed", undefined],
      ["math > subtracts", "failed", 3],
    ])
  })

  it("does not run while the kill switch is engaged, when it cannot be recorded, or for a file outside the project", async () => {
    const root = project("refused", {})
    const killed = explorer({ killed: true })
    await expect(killed.t.run("s1", root, "vitest", {})).rejects.toThrow(/kill switch/)
    expect(killed.records).toEqual([])
    const unrecorded = explorer({ recordOk: false })
    await expect(unrecorded.t.run("s1", root, "vitest", {})).rejects.toThrow(/audit log/)
    expect(fs.existsSync(path.join(root, "args.json"))).toBe(false)
    const { t, records } = explorer()
    await expect(t.run("s1", root, "vitest", { file: "../elsewhere.test.ts" })).rejects.toThrow(/not in the project/)
    await expect(t.run("s1", root, "vitest", { file: path.join(dir, "x.test.ts") })).rejects.toThrow(/not in the project/)
    expect(records).toEqual([])
  })

  it("runs one at a time in a project, and stops a run that takes too long", async () => {
    const root = project("slow", { testResults: [] }, { sleepMs: 5000 })
    const { t, stopped } = explorer({ timeoutMs: 300 })
    const first = t.run("s1", root, "vitest", {})
    await expect(t.run("s1", root, "vitest", {})).rejects.toThrow(/already running/)
    const o = await first
    expect(o.timedOut).toBe(true)
    expect(stopped).toHaveLength(1)
    expect(o.results).toEqual([])
  })
})
