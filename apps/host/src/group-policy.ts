/**
 * D-095: Group Policy, read once when Codehouse starts (a policy refresh applies at the next start), from
 * HKLM\Software\Policies\Codehouse with reg.exe (no native code). Tightening only; see registry-policy.ts. Shown in
 * Doctor with what was applied and anything ignored.
 */
import { execFileSync } from "node:child_process"
import { GPO_KEY, overlayEmpty, parseRegQuery, registryOverlay, type RegistryOverlay } from "@gatehouse/policy"
import type { DoctorCheck } from "./doctor.js"

/** The overlay, or undefined when there is no policy key (or this is not Windows). */
export function readGroupPolicy(platform: NodeJS.Platform = process.platform, run: (key: string) => string = (key) => execFileSync("reg", ["query", key], { encoding: "utf8", windowsHide: true, timeout: 10_000 })): RegistryOverlay | undefined {
  if (platform !== "win32") return undefined
  let out: string
  try {
    out = run(GPO_KEY)
  } catch {
    return undefined
  }
  const values = parseRegQuery(out)
  return values.size ? registryOverlay(values) : undefined
}

export function groupPolicyCheck(o: RegistryOverlay | undefined): DoctorCheck {
  if (!o) return { id: "group-policy", label: "Group Policy", state: "ok", detail: "None set for Codehouse on this computer." }
  const applied = [
    o.deny.length ? `${o.deny.length} command(s) refused` : "",
    o.escalate.length ? `${o.escalate.length} command(s) asked about` : "",
    o.removeAllow.length ? `${o.removeAllow.length} allow rule(s) removed` : "",
    o.cap ? `sessions no higher than ${o.cap === "default" ? "Manual" : o.cap === "acceptEdits" ? "Accept edits" : o.cap === "auto" ? "Auto" : "Plan"}` : "",
  ].filter(Boolean)
  const detail = `${applied.length ? `Applied: ${applied.join(", ")}.` : overlayEmpty(o) ? "Nothing that changes a decision." : ""}${o.ignored.length ? ` Ignored: ${o.ignored.join("; ")}.` : ""}`.trim()
  return o.ignored.length
    ? { id: "group-policy", label: "Group Policy", state: "warn", detail, fix: "Group Policy can only make Codehouse stricter. Ask IT to remove the values Codehouse ignores." }
    : { id: "group-policy", label: "Group Policy", state: "ok", detail }
}
