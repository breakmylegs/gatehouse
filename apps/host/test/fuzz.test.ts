// D-012: the time-boxed fuzz pass finds a seeded crash quickly, keeps to its heap cap, writes what it found where
// D-008 pins it, and leaves a parser's own SyntaxError alone.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { findCounterexamples } from "../src/counterexamples.js"
import { ensureRunner, fuzzTargets, pinLines, runFuzz, type FuzzExec } from "../src/fuzz.js"

let root: string
let data: string
let runner: string
const execs: string[] = []
// Started directly (no shell), so the time box stops the runner itself, as the job object does for a Codehouse action.
const exec: FuzzExec = (command, cwd, timeoutMs) =>
  new Promise((resolve) => {
    execs.push(command)
    const [file, ...args] = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    execFile(file!, args, { cwd, timeout: Math.min(timeoutMs, 8000), windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (e, stdout, stderr) =>
      resolve({ exitCode: e ? (typeof e.code === "number" ? e.code : null) : 0, output: `${stdout}\n${stderr}`, timedOut: Boolean(e?.killed) }),
    )
  })

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-fuzz-")))
  data = fs.mkdtempSync(path.join(os.tmpdir(), "gh-fuzz-data-"))
  runner = await ensureRunner(data)
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  write("src/list.mjs", 'export function parseList(s) {\n  if (s.includes("((")) return s.split("((")[5].length\n  return s.length\n}\n')
  write("src/strict.mjs", 'export function parseStrict(s) {\n  if (s.includes("{")) throw new SyntaxError("unexpected {")\n  return s.length\n}\n')
  write("src/big.mjs", "export function parseBig(s) {\n  if (s.length > 40) { const a = []; for (;;) a.push(new Array(1e6).fill(s)) }\n  return 1\n}\n")
  write("src/slow.mjs", 'export function parseSlow(s) {\n  if (s.includes("}")) for (;;) {}\n  return 1\n}\n')
})
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
})

describe("the fuzz pass", { timeout: 120_000 }, () => {
  it("picks the exported parsing functions of changed source files, not tests", () => {
    expect(
      fuzzTargets([
        { path: "src/a.ts", text: "export function parseDate(s: string) {}\nexport const decodeRow = (s: string) => s\nfunction parseHidden() {}\nexport function render() {}" },
        { path: "src/a.test.ts", text: "export function parseX() {}" },
        { path: "README.md", text: "export function parseY() {}" },
      ]),
    ).toEqual([
      { file: "src/a.ts", fn: "parseDate" },
      { file: "src/a.ts", fn: "decodeRow" },
    ])
  })

  it("finds a seeded crash within 60 seconds, writes its input where D-008 pins it, and leaves SyntaxError alone", async () => {
    const t0 = Date.now()
    const r = await runFuzz({ root, targets: [{ file: "src/list.mjs", fn: "parseList" }, { file: "src/strict.mjs", fn: "parseStrict" }], exec, runner, scratch: path.join(data, "s1"), seed: 7, totalMs: 6000 })
    expect(Date.now() - t0).toBeLessThan(60_000)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ file: "src/list.mjs", fn: "parseList", kind: "crash", error: expect.stringMatching(/^TypeError/) })
    expect(r.findings[0]!.input).toContain("((")
    const written = path.join(root, r.findings[0]!.written!)
    expect(fs.readFileSync(written, "utf8")).toBe(r.findings[0]!.input)
    expect(findCounterexamples(pinLines(r))).toEqual([{ framework: "fuzz", example: r.findings[0]!.written }])
    expect(r.calls).toBeGreaterThan(10)
  })

  it("keeps to its heap cap, and says what input ran it out of memory", async () => {
    const r = await runFuzz({ root, targets: [{ file: "src/big.mjs", fn: "parseBig" }], exec, runner, scratch: path.join(data, "s2"), seed: 3, totalMs: 5000, memoryMb: 64 })
    expect(execs.at(-1)).toMatch(/^node --max-old-space-size=64 /)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ kind: "memory", error: "ran out of the 64 MB heap cap" })
    expect(r.findings[0]!.input.length).toBeGreaterThan(40)
  })

  it("stops a hang at the time box, with the input it hung on", async () => {
    const r = await runFuzz({ root, targets: [{ file: "src/slow.mjs", fn: "parseSlow" }], exec, runner, scratch: path.join(data, "s3"), seed: 5, totalMs: 1000 })
    expect(r.findings[0]).toMatchObject({ kind: "hang" })
    expect(r.findings[0]!.input).toContain("}")
  })

  it("stops when the rules or a person refuse to run it", async () => {
    const refused: FuzzExec = async () => ({ exitCode: null, output: "", timedOut: false, refused: "a person did not allow it" })
    const r = await runFuzz({ root, targets: [{ file: "src/list.mjs", fn: "parseList" }, { file: "src/big.mjs", fn: "parseBig" }], exec: refused, runner, scratch: path.join(data, "s4") })
    expect(r).toMatchObject({ refused: "a person did not allow it", findings: [], calls: 0 })
  })
})
