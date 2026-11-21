/**
 * D-095, Group Policy and Intune (Frontier build). What IT sets under HKLM\Software\Policies\Codehouse (with the ADMX
 * templates in packaging/policy-templates, or Intune's import of them) can only make Codehouse stricter: commands to
 * deny (DenyCommands), commands to ask about (AskCommands), allow rules to remove (RemoveAllow), and the most autonomy a
 * session may have (MaxAutonomy). It is merged like IT's managed policy. A value that tries to allow anything
 * (AllowCommands, or any name Codehouse does not know) is ignored, and Doctor says so.
 */
import type { Rule } from "./types.js"

export const GPO_KEY = "HKLM\\SOFTWARE\\Policies\\Codehouse"
const LEVELS = ["plan", "default", "acceptEdits", "auto"] as const
export type GpoCap = (typeof LEVELS)[number]

export interface RegistryOverlay {
  deny: Rule[]
  escalate: Rule[]
  removeAllow: string[]
  cap?: GpoCap
  /** Values ignored, each with why. */
  ignored: string[]
}

/** The values `reg query <key>` printed, by name; multi-string values split into their lines. */
export function parseRegQuery(output: string): Map<string, { type: string; values: string[] }> {
  const out = new Map<string, { type: string; values: string[] }>()
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s{2,}(\S+)\s+(REG_[A-Z_]+)\s*(.*)$/.exec(line)
    if (!m) continue
    const [, name, type, data = ""] = m
    out.set(name!, { type: type!, values: type === "REG_MULTI_SZ" ? data.split("\\0").map((s) => s.trim()).filter(Boolean) : [data.trim()] })
  }
  return out
}

const COMMAND = /^[^\r\n]{1,300}$/

/** The overlay the registry values make, stricter only; what tries to allow, or is not known, is ignored with a reason. */
export function registryOverlay(values: Map<string, { type: string; values: string[] }>): RegistryOverlay {
  const o: RegistryOverlay = { deny: [], escalate: [], removeAllow: [], ignored: [] }
  for (const [name, v] of values) {
    const key = name.toLowerCase()
    if (key === "denycommands" || key === "askcommands") {
      const kind = key === "denycommands" ? "deny" : "escalate"
      v.values.forEach((cmd, i) => {
        if (!COMMAND.test(cmd)) return void o.ignored.push(`${name} line ${i + 1}: not a command`)
        const rule: Rule = { id: `gpo-${kind}-${i + 1}`, commands: [cmd], message: `Your organisation's Group Policy ${kind === "deny" ? "refuses" : "asks about"} ${cmd}.` } as Rule
        o[kind].push(kind === "escalate" ? ({ ...rule, risk: 60 } as Rule) : rule)
      })
    } else if (key === "removeallow") o.removeAllow.push(...v.values.filter((x) => /^[\w.:-]{1,100}$/.test(x)))
    else if (key === "maxautonomy") {
      const lvl = LEVELS.find((l) => l.toLowerCase() === v.values[0]?.toLowerCase())
      if (lvl) o.cap = lvl
      else o.ignored.push(`MaxAutonomy: ${v.values[0] ?? ""} is not a level (plan, default, acceptEdits or auto)`)
    } else if (key.startsWith("allow")) o.ignored.push(`${name}: Group Policy can only make Codehouse stricter, so a value that allows is ignored`)
    else o.ignored.push(`${name}: not a setting Codehouse knows`)
  }
  return o
}

/** Whether an overlay changes anything. */
export const overlayEmpty = (o: RegistryOverlay) => !o.deny.length && !o.escalate.length && !o.removeAllow.length && !o.cap
