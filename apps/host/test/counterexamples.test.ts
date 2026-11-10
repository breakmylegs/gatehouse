// D-008, pinned counterexamples: a property test's shrunk counterexample becomes a named regression test of its own,
// recorded and locked; one Codehouse cannot write itself is asked of Claude and locked once written.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { CounterexamplePins } from "../src/counterexample-pins.js"
import { findCounterexamples, regressionFor } from "../src/counterexamples.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-cex-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const FAST_CHECK_OUTPUT = ` FAIL  tests/add.test.js > add is commutative
Error: Property failed after 3 tests
{ seed: -1819918769, path: "2:0", endOnFailure: true }
Counterexample: [0,1]
Shrunk 2 time(s)
`

/**
 * fast-check stands in here as it documents examples and numRuns: the examples are tried first, then numRuns random
 * cases. The repository does not depend on fast-check itself.
 */
const FAKE_FAST_CHECK = `exports.integer = () => ({ gen: () => Math.floor(Math.random() * 200) - 100 })
exports.property = (...a) => { const pred = a.pop(); return { arbs: a, pred } }
exports.assert = (p, o = {}) => {
  for (const ex of o.examples ?? []) if (p.pred(...ex) === false) throw new Error("Property failed on " + JSON.stringify(ex))
  for (let i = 0; i < (o.numRuns ?? 100); i++) {
    const v = p.arbs.map((a) => a.gen())
    if (p.pred(...v) === false) throw new Error("Property failed on " + JSON.stringify(v))
  }
}
`

function fixture(): string {
  const root = path.join(dir, "proj")
  fs.mkdirSync(path.join(root, "node_modules", "fast-check"), { recursive: true })
  fs.mkdirSync(path.join(root, "src"), { recursive: true })
  fs.mkdirSync(path.join(root, "tests"), { recursive: true })
  fs.writeFileSync(path.join(root, "node_modules", "fast-check", "index.js"), FAKE_FAST_CHECK)
  // The bug: adding to zero is off by one, so add(0, 1) is not add(1, 0).
  fs.writeFileSync(path.join(root, "src", "add.js"), "exports.add = (a, b) => (a === 0 ? b + 1 : a + b)\n")
  fs.writeFileSync(
    path.join(root, "tests", "add.test.js"),
    `const fc = require("fast-check")
const { add } = require("../src/add")

it("add is commutative", () => {
  fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) => add(a, b) === add(b, a)))
})
`,
  )
  return root
}

/** Runs a test file with a plain it(), as a test runner would: exit 0 when it passes. */
const runs = (root: string, file: string) =>
  spawnSync(process.execPath, ["-e", `global.it = (n, f) => f(); require(${JSON.stringify(file)})`], {
    cwd: root,
    encoding: "utf8",
  }).status

describe("pinned counterexamples (D-008)", () => {
  it("reads the counterexamples of fast-check, Hypothesis, FsCheck and a fuzz run", () => {
    expect(findCounterexamples(FAST_CHECK_OUTPUT)).toEqual([
      { framework: "fast-check", file: "tests/add.test.js", test: "add is commutative", example: "[0,1]" },
    ])
    expect(
      findCounterexamples(
        "Falsifying example: test_add(\n    a=0,\n    b=1,\n)\nFAILED tests/test_add.py::test_add - AssertionError",
      ),
    ).toEqual([{ framework: "hypothesis", test: "test_add", file: "tests/test_add.py", example: "a=0, b=1" }])
    expect(
      findCounterexamples("Falsifiable, after 3 tests (1 shrink) (StdGen (1,2)):\nOriginal:\n(5, 9)\nShrunk:\n(0, 1)\n"),
    ).toEqual([{ framework: "fscheck", example: "(0, 1)" }])
    expect(findCounterexamples("    Failing input written to testdata/fuzz/FuzzParse/582528ddfad69eb5")).toEqual([
      { framework: "fuzz", example: "testdata/fuzz/FuzzParse/582528ddfad69eb5" },
    ])
    expect(findCounterexamples("Tests  3 passed (3)")).toEqual([])
  })

  it("writes a regression test that fails before the fix and passes after it, recorded and locked", async () => {
    const root = fixture()
    // The property itself fails on the buggy add.
    expect(runs(root, "./tests/add.test.js")).not.toBe(0)
    const records: Array<Record<string, unknown>> = []
    const locked: string[] = []
    const pins = new CounterexamplePins({
      sessionId: "s1",
      cwd: root,
      project: "proj",
      audit: { record: async (r) => (records.push(r as unknown as Record<string, unknown>), true) },
      locks: { lock: async (_cwd, f) => (locked.push(f), f) },
      prompt: () => undefined,
    })
    expect(pins.noteOutput(FAST_CHECK_OUTPUT)).toBe(true)
    const [p] = pins.list()
    expect(p).toMatchObject({ framework: "fast-check", writesItself: true })
    const r = await pins.pin(p!.id)
    expect(r).toEqual({ file: "tests/add.regression-0-1.test.js", by: "codehouse" })
    const written = fs.readFileSync(path.join(root, r.file), "utf8")
    expect(written).toContain('it("regression: add is commutative for [0,1]"')
    expect(written).toContain("examples: [[0,1]], numRuns: 0")
    expect(locked).toEqual(["tests/add.regression-0-1.test.js"])
    expect(records[0]).toMatchObject({ event: "counterexample_pinned", input: { framework: "fast-check", by: "codehouse" } })
    // It fails before the fix, every time (it runs only the counterexample) ...
    for (let i = 0; i < 3; i++) expect(runs(root, `./${r.file}`)).not.toBe(0)
    // ... and passes after it.
    fs.writeFileSync(path.join(root, "src", "add.js"), "exports.add = (a, b) => a + b\n")
    expect(runs(root, `./${r.file}`)).toBe(0)
  })

  it("copies a Hypothesis test into one that runs only the falsifying example", () => {
    const src = `import pytest
from hypothesis import given, settings, strategies as st
from app import add


@settings(max_examples=500)
@given(st.integers(), st.integers())
def test_add(a, b):
    assert add(a, b) == add(b, a)


def test_other():
    assert True
`
    const reg = regressionFor(
      { framework: "hypothesis", test: "test_add", file: "tests/test_add.py", example: "a=0, b=1" },
      src,
    )!
    expect(reg.file).toBe("test_add_regression_a_0_b_1.py")
    expect(reg.content).toContain("from app import add")
    expect(reg.content).toContain("@example(a=0, b=1)\n@settings(phases=[Phase.explicit])\n@given(st.integers(), st.integers())")
    expect(reg.content).toContain("def test_add_regression_a_0_b_1(a, b):")
    expect(reg.content).not.toContain("max_examples=500")
    expect(reg.content).not.toContain("test_other")
  })

  it("asks Claude for one it cannot write itself, and locks the file once Claude has written it", async () => {
    const root = path.join(dir, "cs")
    fs.mkdirSync(root, { recursive: true })
    const asked: string[] = []
    const locked: string[] = []
    const records: Array<Record<string, unknown>> = []
    const pins = new CounterexamplePins({
      sessionId: "s1",
      cwd: root,
      project: "cs",
      audit: { record: async (r) => (records.push(r as unknown as Record<string, unknown>), true) },
      locks: { lock: async (_cwd, f) => (locked.push(f), f) },
      prompt: (t) => asked.push(t),
    })
    pins.noteOutput("Falsifiable, after 3 tests (1 shrink) (StdGen (1,2)):\nOriginal:\n(5, 9)\nShrunk:\n(0, 1)\n")
    const r = await pins.pin(pins.list()[0]!.id)
    expect(r).toEqual({ file: "tests/Regression_0_1.cs", by: "claude" })
    expect(asked[0]).toContain("(0, 1)")
    expect(asked[0]).toContain("tests/Regression_0_1.cs")
    expect(locked).toEqual([])
    expect(await pins.noteWritten(path.join(root, "tests", "Regression_0_1.cs"))).toBe(true)
    expect(locked).toEqual(["tests/Regression_0_1.cs"])
    expect(records[0]).toMatchObject({ event: "counterexample_pinned", input: { by: "claude" } })
    // Another file Claude writes is not taken for it.
    expect(await pins.noteWritten(path.join(root, "src", "Other.cs"))).toBe(false)
  })

  it("writes nothing when the pin cannot be recorded", async () => {
    const root = fixture()
    fs.rmSync(path.join(root, "tests", "add.regression-0-1.test.js"), { force: true })
    const pins = new CounterexamplePins({
      sessionId: "s1",
      cwd: root,
      project: "proj",
      audit: { record: async () => false },
      prompt: () => undefined,
    })
    pins.noteOutput(FAST_CHECK_OUTPUT)
    await expect(pins.pin(pins.list()[0]!.id)).rejects.toThrow(/could not be recorded/)
    expect(fs.existsSync(path.join(root, "tests", "add.regression-0-1.test.js"))).toBe(false)
  })
})
