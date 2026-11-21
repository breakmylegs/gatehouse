// D-070: what in a project's PowerShell scripts will not run in PowerShell 7, reported per script, read with the AST
// worker; PSScriptAnalyzer's findings added where it is installed.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PwshWorker } from "@gatehouse/policy"
import { modernise, scriptsIn } from "../src/pwsh-modernise.js"

let root: string
let worker: PwshWorker
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-ps7-"))
  write(
    "scripts/old.ps1",
    [
      "# Inventory, written for Windows PowerShell",
      "$disks = Get-WmiObject Win32_LogicalDisk",
      "$os = gwmi Win32_OperatingSystem",
      "curl https://example.test/status",
      "$bytes = Get-Content .\\logo.png -Encoding Byte",
      "Get-EventLog -LogName System -Newest 5",
    ].join("\n"),
  )
  write("scripts/new.ps1", "$disks = Get-CimInstance Win32_LogicalDisk\n$bytes = Get-Content .\\logo.png -AsByteStream\n")
  write("scripts/flow.ps1", "workflow Copy-All {\n  Get-Date\n}\n")
  write("tools/Mod.psm1", "function Get-Thing { Add-PSSnapin Old.Snapin }\n")
  write("node_modules/x/install.ps1", "Get-WmiObject x\n")
  worker = new PwshWorker()
  await worker.start()
}, 60_000)
afterAll(() => {
  worker.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe("PowerShell modernisation", { timeout: 60_000 }, () => {
  it("lists the project's scripts and modules, not those others wrote", () => {
    expect(scriptsIn(root)).toEqual(["scripts/flow.ps1", "scripts/new.ps1", "scripts/old.ps1", "tools/Mod.psm1"])
  })

  it("reports each script's findings with line, rule and the replacement, and none for a modern script", async () => {
    const reports = await modernise({ root, parse: (t) => worker.parse(t) })
    const by = Object.fromEntries(reports.map((r) => [r.file, r]))
    expect(by["scripts/new.ps1"]!.findings).toEqual([])
    expect(by["scripts/old.ps1"]!.findings.map((f) => [f.line, f.rule])).toEqual([
      [2, "cmdlet-removed"],
      [3, "alias-removed"],
      [4, "alias-removed"],
      [5, "encoding-byte"],
      [6, "cmdlet-removed"],
    ])
    expect(by["scripts/old.ps1"]!.findings[0]).toMatchObject({ message: "Get-WmiObject is not in PowerShell 7.", fix: "Use Get-CimInstance." })
    expect(by["scripts/old.ps1"]!.findings[3]!.fix).toBe("Use -AsByteStream.")
    expect(by["scripts/flow.ps1"]!.findings).toMatchObject([{ line: 1, rule: "workflow" }])
    expect(by["tools/Mod.psm1"]!.findings).toMatchObject([{ line: 1, rule: "cmdlet-removed", fix: "Use Import-Module." }])
  })

  it("adds PSScriptAnalyzer's findings where it is installed", async () => {
    const reports = await modernise({
      root,
      parse: (t) => worker.parse(t),
      analyzer: async (file) => (file.endsWith("new.ps1") ? [{ RuleName: "PSUseCompatibleSyntax", Line: 1, Message: "Something PowerShell 7 reads differently." }] : undefined),
    })
    const r = reports.find((x) => x.file === "scripts/new.ps1")!
    expect(r).toMatchObject({ analyzer: true, findings: [{ line: 1, rule: "PSScriptAnalyzer PSUseCompatibleSyntax" }] })
    expect(reports.find((x) => x.file === "scripts/old.ps1")!.analyzer).toBeUndefined()
  })
})
