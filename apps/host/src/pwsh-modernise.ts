/**
 * D-070, PowerShell modernisation (Frontier build): what in a project's scripts will not run, or runs differently, in
 * PowerShell 7 than in Windows PowerShell 5.1. With PSScriptAnalyzer installed its findings are used too (it reads the
 * scripts, never runs them). Otherwise, and as well, each script is read with Codehouse's own PowerShell parser (the
 * AST worker the policy uses) and checked against what changed: cmdlets that are gone (WMI, the event log ones,
 * snap-ins, transactions, New-WebServiceProxy), aliases removed in 7 (curl, wget, sc, the WMI ones), -Encoding Byte,
 * and workflows. Nothing is run and nothing is changed; findings are reported per script.
 */
import fs from "node:fs"
import path from "node:path"
import type { RawAnalysis } from "@gatehouse/policy"

export interface PsFinding {
  line: number
  rule: string
  message: string
  fix?: string
}

export interface PsReport {
  file: string
  findings: PsFinding[]
  /** The parser could not read all of it (a workflow is one cause in PowerShell 7). */
  parseError?: boolean
  /** PSScriptAnalyzer's findings were included. */
  analyzer?: boolean
}

/** Cmdlets Windows PowerShell 5.1 has and PowerShell 7 does not, with what to use instead. */
export const GONE: Record<string, string> = {
  "get-wmiobject": "Get-CimInstance",
  "invoke-wmimethod": "Invoke-CimMethod",
  "set-wmiinstance": "Set-CimInstance or New-CimInstance",
  "remove-wmiobject": "Remove-CimInstance",
  "register-wmievent": "Register-CimIndicationEvent",
  "get-eventlog": "Get-WinEvent",
  "write-eventlog": "New-WinEvent, or the System.Diagnostics.EventLog class",
  "new-eventlog": "the System.Diagnostics.EventLog class",
  "remove-eventlog": "the System.Diagnostics.EventLog class",
  "clear-eventlog": "wevtutil cl",
  "limit-eventlog": "wevtutil sl",
  "show-eventlog": "eventvwr",
  "new-webserviceproxy": "Invoke-RestMethod, or a client generated for the service",
  "add-pssnapin": "Import-Module",
  "get-pssnapin": "Get-Module",
  "remove-pssnapin": "Remove-Module",
  "export-console": "a profile script",
  "start-transaction": "no replacement: transactions are not in PowerShell 7",
  "complete-transaction": "no replacement: transactions are not in PowerShell 7",
  "undo-transaction": "no replacement: transactions are not in PowerShell 7",
  "use-transaction": "no replacement: transactions are not in PowerShell 7",
  "get-transaction": "no replacement: transactions are not in PowerShell 7",
}

/** Aliases 5.1 has that PowerShell 7 removed, with the command to name instead. */
export const ALIASES_GONE: Record<string, string> = {
  curl: "Invoke-WebRequest (curl now runs curl.exe)",
  wget: "Invoke-WebRequest",
  sc: "Set-Content (sc now runs sc.exe)",
  gwmi: "Get-CimInstance",
  iwmi: "Invoke-CimMethod",
  swmi: "Set-CimInstance",
  rwmi: "Remove-CimInstance",
}

/** The line a command name first appears on at or after `from`, for findings the parser gives without a line. */
function lineOf(lines: string[], name: string, from: number): number {
  const re = new RegExp(String.raw`(^|[^\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\w-])`, "i")
  for (let i = from; i < lines.length; i++) if (re.test(lines[i]!)) return i + 1
  for (let i = 0; i < from; i++) if (re.test(lines[i]!)) return i + 1
  return 1
}

/** The built-in check of one script's text, from the parser's commands. */
export function checkScript(text: string, raw: RawAnalysis): Omit<PsReport, "file"> {
  const lines = text.split(/\r?\n/)
  const findings: PsFinding[] = []
  let at = 0
  for (const cmd of raw.commands) {
    const name = (cmd.name ?? "").trim()
    if (!name) continue
    const lower = name.toLowerCase()
    const line = lineOf(lines, name, at)
    at = line - 1
    if (ALIASES_GONE[lower])
      findings.push({ line, rule: "alias-removed", message: `The alias ${name} is not in PowerShell 7.`, fix: `Use ${ALIASES_GONE[lower]}.` })
    else if (GONE[lower]) findings.push({ line, rule: "cmdlet-removed", message: `${name} is not in PowerShell 7.`, fix: `Use ${GONE[lower]}.` })
    const args = cmd.elements.slice(1).map((e) => e.value)
    const enc = args.findIndex((a) => /^-Encoding(:|$)/i.test(a))
    const value = enc < 0 ? undefined : /:/.test(args[enc]!) ? args[enc]!.split(":")[1] : args[enc + 1]
    if (value && /^byte$/i.test(value)) findings.push({ line, rule: "encoding-byte", message: `${name} -Encoding Byte is not in PowerShell 7.`, fix: "Use -AsByteStream." })
  }
  lines.forEach((l, i) => {
    if (/^\s*workflow\s+[\w-]+/i.test(l)) findings.push({ line: i + 1, rule: "workflow", message: "Workflows are not in PowerShell 7.", fix: "Use functions, with ForEach-Object -Parallel or jobs for what ran in parallel." })
  })
  return { findings: findings.sort((a, b) => a.line - b.line), ...(raw.ok ? {} : { parseError: true }) }
}

/** The PowerShell scripts of a project, at most 200, build output and modules others wrote left out. */
export function scriptsIn(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < 200) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!["node_modules", ".git", "dist", "build", "bin", "obj", "out"].includes(e.name)) stack.push(p)
      } else if (/\.ps(m?1)$/i.test(e.name)) out.push(path.relative(root, p).replace(/\\/g, "/"))
    }
  }
  return out.sort()
}

export type AnalyzerRun = (file: string) => Promise<Array<{ RuleName: string; Line: number; Message: string }> | undefined>

/** Each script's findings: the built-in check, with PSScriptAnalyzer's added where it is installed. */
export async function modernise(o: { root: string; parse: (text: string) => Promise<RawAnalysis>; analyzer?: AnalyzerRun }): Promise<PsReport[]> {
  const reports: PsReport[] = []
  for (const file of scriptsIn(o.root)) {
    const text = fs.readFileSync(path.join(o.root, file), "utf8").replace(/^\uFEFF/, "")
    let report: PsReport
    try {
      report = { file, ...checkScript(text, await o.parse(text)) }
    } catch {
      report = { file, findings: [], parseError: true }
    }
    const extra = await o.analyzer?.(path.join(o.root, file)).catch(() => undefined)
    if (extra) {
      report.analyzer = true
      for (const x of extra) report.findings.push({ line: x.Line, rule: `PSScriptAnalyzer ${x.RuleName}`, message: x.Message })
      report.findings.sort((a, b) => a.line - b.line)
    }
    reports.push(report)
  }
  return reports
}

/** The PowerShell that runs PSScriptAnalyzer when it is installed: its 5.1-to-7 rules, its findings as JSON, or nothing. */
export const ANALYZER_SCRIPT = `param([string]$Path)
if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) { 'NOPSSA'; return }
$settings = @{ IncludeRules = @('PSUseCompatibleSyntax', 'PSAvoidUsingWMICmdlet', 'PSAvoidUsingCmdletAliases'); Rules = @{ PSUseCompatibleSyntax = @{ Enable = $true; TargetVersions = @('7.0') } } }
@(Invoke-ScriptAnalyzer -Path $Path -Settings $settings | Select-Object RuleName, Line, Message) | ConvertTo-Json -Compress -Depth 3`
