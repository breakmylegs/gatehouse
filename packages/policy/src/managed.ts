import type { ManagedSettings } from "./types.js"

/**
 * T-067: what the organisation's settings in IT's signed policy allow. Each check only narrows: with no managed
 * settings, or a setting left out, everything Codehouse otherwise allows stays allowed.
 */
export const MODE_ORDER = ["plan", "default", "acceptEdits", "auto"] as const
export type ManagedMode = (typeof MODE_ORDER)[number]

export const managedLabel = (m: ManagedSettings | undefined) => `Managed by ${m?.managedBy?.trim() || "your organisation"}`

/** Whether a session may use this permission mode. An unknown mode is never allowed under a cap. */
export function modeAllowed(m: ManagedSettings | undefined, mode: string): boolean {
  if (!m?.maxMode) return true
  const at = MODE_ORDER.indexOf(mode as ManagedMode)
  return at >= 0 && at <= MODE_ORDER.indexOf(m.maxMode)
}

export const extremeAllowed = (m: ManagedSettings | undefined) => m?.extremeApproval !== false

export const providerAllowed = (m: ManagedSettings | undefined, provider: "claude" | "local" | "gateway") => !m?.providers || m.providers.includes(provider)

export const phoneAllowed = (m: ManagedSettings | undefined) => m?.phone !== false

/** The locked settings a change would alter: compared by value, a setting added or removed counts too. */
export function lockedChanges(m: ManagedSettings | undefined, before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  if (!m?.locked?.length) return []
  return m.locked.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
}

/** Why something is refused, in the words the screen shows. */
export const managedRefusal = (m: ManagedSettings | undefined, what: string) => `${managedLabel(m)}: ${what}.`

/** The settings in words, one line each, for `policy show` and the Settings page. */
export function describeManaged(m: ManagedSettings | undefined): string[] {
  if (!m) return ["No settings are managed by your organisation."]
  const lines = [managedLabel(m)]
  if (m.maxMode) lines.push(`The broadest permission mode allowed is ${m.maxMode}.`)
  if (m.extremeApproval === false) lines.push("Max approval is turned off.")
  if (m.providers) lines.push(`AI providers allowed: ${m.providers.length ? m.providers.join(", ") : "none"}.`)
  if (m.phone === false) lines.push("The phone, the Relay and push channels are turned off.")
  if (m.locked?.length) lines.push(`Settings you cannot change here: ${m.locked.join(", ")}.`)
  return lines
}
