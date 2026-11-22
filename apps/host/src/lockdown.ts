/**
 * D-097, Constrained Language Mode awareness (Frontier build). On a computer where PowerShell is locked down (its
 * language mode Constrained, set by AppLocker or WDAC's user-mode code integrity, or by __PSLockdownPolicy), many
 * ordinary commands fail with messages that do not say why. Doctor shows the language mode and the hints of what sets
 * it, from one PowerShell query that needs no administrator rights, read once a start. And when a PowerShell or shell
 * call fails with one of those messages, Claude is told the likely cause beside the error, so it stops retrying and
 * works within it.
 */
import { execFile } from "node:child_process"
import type { DoctorCheck } from "./doctor.js"

export interface LockdownFacts {
  languageMode: string
  /** Windows PowerShell's mode, when it differs from the one Codehouse's PowerShell runs. */
  lockdownEnv?: string
  /** Device Guard's user-mode code integrity: 0 off, 1 audit, 2 enforced. */
  umci?: number
  /** Rules in the effective AppLocker policy for scripts and programs. */
  appLockerRules?: number
}

const QUERY = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$m = [string]$ExecutionContext.SessionState.LanguageMode",
  "$u = (Get-CimInstance -Namespace root\\Microsoft\\Windows\\DeviceGuard -ClassName Win32_DeviceGuard).UsermodeCodeIntegrityPolicyEnforcementStatus",
  "$a = 0; try { $a = ([xml](Get-AppLockerPolicy -Effective -Xml)).AppLockerPolicy.RuleCollection | ForEach-Object { $_.ChildNodes.Count } | Measure-Object -Sum | Select-Object -ExpandProperty Sum } catch {}",
  "[pscustomobject]@{ languageMode = $m; lockdownEnv = [string]$env:__PSLockdownPolicy; umci = $u; appLockerRules = $a } | ConvertTo-Json -Compress",
].join("; ")

export function readLockdown(exe: string): Promise<LockdownFacts | undefined> {
  return new Promise((resolve) =>
    execFile(exe, ["-NoProfile", "-NonInteractive", "-Command", QUERY], { windowsHide: true, timeout: 20_000 }, (e, out) => {
      if (e) return resolve(undefined)
      try {
        const v = JSON.parse(String(out)) as { languageMode?: string; lockdownEnv?: string; umci?: number | null; appLockerRules?: number | null }
        resolve({
          languageMode: v.languageMode || "unknown",
          ...(v.lockdownEnv ? { lockdownEnv: v.lockdownEnv } : {}),
          ...(typeof v.umci === "number" ? { umci: v.umci } : {}),
          ...(typeof v.appLockerRules === "number" && v.appLockerRules > 0 ? { appLockerRules: v.appLockerRules } : {}),
        })
      } catch {
        resolve(undefined)
      }
    }),
  )
}

export function lockdownCheck(f: LockdownFacts | undefined): DoctorCheck {
  if (!f) return { id: "powershell-mode", label: "PowerShell language mode", state: "warn", detail: "Codehouse could not ask PowerShell for its language mode." }
  const hints = [
    f.umci === 2 ? "Windows Defender Application Control enforces code integrity for programs and scripts" : f.umci === 1 ? "Windows Defender Application Control audits programs and scripts" : "",
    f.appLockerRules ? `AppLocker has ${f.appLockerRules} rule(s) in effect` : "",
    f.lockdownEnv ? `__PSLockdownPolicy is set (${f.lockdownEnv})` : "",
  ].filter(Boolean)
  const said = `${f.languageMode}${hints.length ? `; ${hints.join("; ")}` : ""}.`
  return f.languageMode === "FullLanguage"
    ? { id: "powershell-mode", label: "PowerShell language mode", state: "ok", detail: said }
    : {
        id: "powershell-mode",
        label: "PowerShell language mode",
        state: "warn",
        detail: said,
        fix: "PowerShell is locked down here, so commands that call .NET methods, Add-Type or COM fail. That is set by your organisation; Codehouse and Claude work within it.",
      }
}

const SIGNS: Array<[RegExp, string]> = [
  [/supported only on core types in this language mode|language mode|ConstrainedLanguage|Cannot create type\. Only core types are supported/i, "PowerShell here runs in Constrained Language Mode (set by AppLocker, WDAC or __PSLockdownPolicy), so .NET method calls, Add-Type, New-Object of other types and COM are refused."],
  [/blocked by (group|your organi[sz]ation'?s?|your system administrator)|has been blocked by your system administrator/i, "Your organisation's AppLocker or software restriction policy blocks this program or script."],
  [/Application Control policy has blocked this file|blocked by Windows Defender Application Control|code integrity/i, "Windows Defender Application Control blocks this file because it is not allowed by your organisation's policy."],
  [/running scripts is disabled on this system|cannot be loaded because running scripts is disabled/i, "The execution policy refuses script files here. Run the commands inline rather than as a .ps1, and do not try to change the policy."],
]

/** Why a failed command most likely failed, when it carries a lockdown's signature; undefined otherwise. */
export function lockdownHint(tool: string, error: string): string | undefined {
  if (tool !== "PowerShell" && tool !== "Bash") return undefined
  const hit = SIGNS.find(([re]) => re.test(error))
  return hit ? `Codehouse: the likely cause is this computer's lockdown, not the command. ${hit[1]} Do not retry the same way; find a way that works within it, or tell the user.` : undefined
}
