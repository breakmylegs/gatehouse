import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { canonicalCommandName, PwshUnavailableError, PwshWorker, toAnalysis, analysePwsh } from "../src/pwsh.js"
import type { RawAnalysis } from "../src/pwsh.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const REAL_SCRIPT = path.resolve(here, "../../../scripts/ps-ast.ps1")

let dir: string
const workers: PwshWorker[] = []

function script(name: string, body: string): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, body)
  return file
}

function worker(opts: ConstructorParameters<typeof PwshWorker>[0]): PwshWorker {
  const w = new PwshWorker(opts)
  workers.push(w)
  return w
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-pwsh-"))
})
afterAll(() => {
  for (const w of workers) w.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const READY = `'{"ready":true,"languageMode":"FullLanguage"}'`

describe("PwshWorker", () => {
  it("starts warm, reports the language mode and parses text", async () => {
    const w = worker({})
    await w.start()
    expect(w.running).toBe(true)
    expect(w.languageMode).toBe("FullLanguage")
    const raw = await w.parse("Get-ChildItem -Recurse | Select-Object Name")
    expect(raw.ok).toBe(true)
    expect(raw.commands.map((c) => c.name)).toEqual(["Get-ChildItem", "Select-Object"])
    expect(await w.parse("Get-ChildItem {")).toMatchObject({ ok: false })
  })

  it("handles unicode, many requests in flight and a second start()", async () => {
    const w = worker({})
    await Promise.all([w.start(), w.start()])
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => w.parse(`Write-Output 'café ${i}'`)),
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.map((r) => r.commands[0]?.elements[1]?.value)).toEqual(
      Array.from({ length: 12 }, (_, i) => `café ${i}`),
    )
  })

  it("rejects when pwsh cannot be started (fail closed)", async () => {
    const w = worker({ pwsh: "definitely-not-a-real-pwsh-binary" })
    await expect(w.parse("Get-ChildItem")).rejects.toBeInstanceOf(PwshUnavailableError)
    // A recent failure is not retried straight away.
    await expect(w.parse("Get-ChildItem")).rejects.toBeInstanceOf(PwshUnavailableError)
    expect(w.running).toBe(false)
  })

  it("rejects when the worker never becomes ready", async () => {
    const w = worker({ script: script("never-ready.ps1", "Start-Sleep 30"), timeoutMs: 400 })
    await expect(w.start()).rejects.toBeInstanceOf(PwshUnavailableError)
    expect(w.running).toBe(false)
  })

  it("rejects a request that is never answered and tears the worker down", async () => {
    const w = worker({
      script: script("hang.ps1", `${READY}\n[Console]::Out.Flush()\nStart-Sleep 30`),
      timeoutMs: 2500,
    })
    await expect(w.parse("Get-ChildItem")).rejects.toThrow(/timed out/)
    expect(w.running).toBe(false)
  })

  it("ignores noise and answers for unknown ids, then times out", async () => {
    const w = worker({
      script: script(
        "noise.ps1",
        `${READY}\n[Console]::Out.Flush()\n$null = [Console]::In.ReadLine()\n'not json'\n'[1,2]'\n'{"id":9999}'\n'{"nothing":1}'\n[Console]::Out.Flush()\nStart-Sleep 30`,
      ),
      timeoutMs: 2500,
    })
    await expect(w.parse("Get-ChildItem")).rejects.toThrow(/timed out/)
  })

  it("caches successful parses, so a repeated command needs no worker", async () => {
    const w = worker({})
    const first = await w.parse("Get-ChildItem -Recurse")
    w.close()
    expect(w.running).toBe(false)
    expect(await w.parse("Get-ChildItem -Recurse")).toBe(first)
    expect(w.running).toBe(false)
  })

  it("does not cache a failure", async () => {
    const w = worker({ pwsh: "definitely-not-a-real-pwsh-binary" })
    await expect(w.parse("Get-Process")).rejects.toBeInstanceOf(PwshUnavailableError)
  })

  it("evicts the oldest entries beyond its size", async () => {
    const w = worker({})
    await w.start()
    for (let i = 0; i < 270; i++) await w.parse(`Write-Output ${i}`)
    w.close()
    await expect(w.parse("Write-Output 0")).resolves.toMatchObject({ ok: true })
    expect(w.running).toBe(true)
    await w.parse("Write-Output 269")
  }, 60000)

  it("rejects an in-flight request when the process dies, then starts a new one", async () => {
    const flag = path.join(dir, "crash.flag")
    const crashOnce = script(
      "crash-once.ps1",
      [
        "param([switch]$Loop)",
        "if (-not (Test-Path $env:GH_TEST_FLAG)) {",
        "  New-Item $env:GH_TEST_FLAG -ItemType File | Out-Null",
        `  ${READY}`,
        "  [Console]::Out.Flush()",
        "  $null = [Console]::In.ReadLine()",
        "  exit 3",
        "} else {",
        "  & $env:GH_TEST_REAL -Loop",
        "}",
      ].join("\n"),
    )
    process.env.GH_TEST_FLAG = flag
    process.env.GH_TEST_REAL = REAL_SCRIPT
    const w = worker({ script: crashOnce, timeoutMs: 5000 })
    await expect(w.parse("Get-ChildItem")).rejects.toBeInstanceOf(PwshUnavailableError)
    const again = await w.parse("Get-ChildItem")
    expect(again.ok).toBe(true)
    delete process.env.GH_TEST_FLAG
    delete process.env.GH_TEST_REAL
  })

  it("close() is safe to repeat and rejects later work only by restarting", async () => {
    const w = worker({})
    await w.start()
    w.close()
    w.close()
    expect(w.running).toBe(false)
    expect((await w.parse("Get-ChildItem")).ok).toBe(true)
  })

  it("analysePwsh turns the raw parse into segments and flags", async () => {
    const w = worker({})
    const a = await analysePwsh(w, "gci -Recurse; iex 'x'")
    expect(a.segments.map((s) => s.text)).toEqual(["Get-ChildItem -Recurse", "Invoke-Expression x"])
    expect(a.flags.invokeExpression).toBe(true)
  })
})

describe("scripts/ps-ast.ps1 single-shot mode", () => {
  it("reads stdin and writes one JSON document", () => {
    const out = execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", REAL_SCRIPT], {
      input: "Get-Content README.md > out.txt",
      encoding: "utf8",
    })
    const parsed = JSON.parse(out) as RawAnalysis
    expect(parsed.ok).toBe(true)
    expect(parsed.commands[0]?.name).toBe("Get-Content")
    expect(parsed.redirects).toEqual([{ target: "out.txt", dynamic: false, append: false }])
  })
})

describe("canonicalCommandName", () => {
  it("resolves aliases and strips module qualifiers", () => {
    expect(canonicalCommandName("GCI")).toBe("Get-ChildItem")
    expect(canonicalCommandName("%")).toBe("ForEach-Object")
    expect(canonicalCommandName("Microsoft.PowerShell.Utility\\Invoke-Expression")).toBe("Invoke-Expression")
    expect(canonicalCommandName(".\\script.ps1")).toBe(".\\script.ps1")
    expect(canonicalCommandName("git")).toBe("git")
  })
})

describe("toAnalysis", () => {
  const base: RawAnalysis = { ok: true, errors: [], commands: [], redirects: [], members: [], strings: [] }
  const el = (value: string, dynamic = false) => ({ type: "StringConstantExpressionAst", value, dynamic })

  it("flags parse failure, null redirects and registry writes", () => {
    expect(toAnalysis({ ...base, ok: false }).parseError).toBe(true)
    const withNullRedirect = toAnalysis({
      ...base,
      commands: [{ name: "Get-ChildItem", invocation: "Unknown", elements: [el("Get-ChildItem")] }],
      redirects: [{ target: "$null", dynamic: false, append: false }],
    })
    expect(withNullRedirect.segments[0]?.writes).toBe(false)
    const registry = toAnalysis({
      ...base,
      commands: [
        { name: "Set-ItemProperty", invocation: "Unknown", elements: [el("Set-ItemProperty"), el("-Path:HKLM:\\SOFTWARE\\x")] },
      ],
    })
    expect(registry.flags.registryWrite).toBe(true)
    const dynamicRedirect = toAnalysis({
      ...base,
      commands: [{ name: "echo", invocation: "Unknown", elements: [el("echo")] }],
      redirects: [{ target: "$f", dynamic: true, append: true }],
    })
    expect(dynamicRedirect.segments[0]?.writes).toBe(true)
  })

  it("flags members: downloads, script block construction, InvokeScript", () => {
    const a = toAnalysis({
      ...base,
      members: [
        { member: "DownloadString", target: "$w", static: false },
        { member: "Create", target: "[ScriptBlock]", static: true },
        { member: "InvokeScript", target: "$ExecutionContext.InvokeCommand", static: false },
      ],
    })
    expect(a.flags.downloadString).toBe(true)
    expect(a.flags.scriptBlockCreate).toBe(true)
    const b = toAnalysis({ ...base, members: [{ member: "Create", target: "[System.IO.Path]", static: true }] })
    expect(b.flags.scriptBlockCreate).toBe(false)
  })

  it("marks a command with no name as dynamic invocation", () => {
    const a = toAnalysis({
      ...base,
      commands: [{ name: null, invocation: "Ampersand", elements: [{ type: "VariableExpressionAst", value: "$x", dynamic: true }] }],
    })
    expect(a.flags.dynamicInvocation).toBe(true)
    expect(a.segments[0]).toMatchObject({ name: "", dynamic: true, kind: "pwsh" })
  })
})
