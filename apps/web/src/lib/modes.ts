import type { SessionInfo } from "@gatehouse/shared/ws-protocol"

/**
 * What a session's mode picker offers. Extreme approval is shown as a mode because that is how you choose it, but
 * underneath it is Manual (default) with every request that would ask you approved, audited and told to the phone.
 */
export type UiMode = "auto" | "default" | "acceptEdits" | "plan" | "extreme" | "extremeMax"

export const MODE_OPTIONS: Array<{ id: UiMode; label: string; help: string }> = [
  {
    id: "auto",
    label: "Auto",
    help: "Claude Code decides routine actions; your denies and High risk still come to Codehouse",
  },
  { id: "default", label: "Manual", help: "Ask before anything the rules do not allow" },
  {
    id: "acceptEdits",
    label: "Accept edits",
    help: "Accept file edits in the folder without asking",
  },
  { id: "plan", label: "Plan", help: "Make a plan before changing anything" },
  {
    id: "extreme",
    label: "Extreme approval",
    // O36 (owner, 15 Nov): Rules-based, the limit set in Settings.
    help: "Approve what would ask you below the risk limit in Settings; at or above it, ask you",
  },
  {
    id: "extremeMax",
    label: "Extreme max approval",
    help: "Approve everything that would ask you, whatever the risk; the floor still blocks",
  },
]

/** Never offered: it would skip the Approver and the floor. Shown so its absence is explained. */
export const BYPASS_NOTE =
  "Bypass permissions is not offered: Codehouse always checks every request."

export const EFFORTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium (recommended)" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra" },
  { id: "max", label: "Max" },
] as const
export type EffortId = (typeof EFFORTS)[number]["id"]

export function uiModeOf(s: Pick<SessionInfo, "mode" | "extreme" | "extremeMax">): UiMode {
  return s.extreme ? (s.extremeMax ? "extremeMax" : "extreme") : s.mode
}

/** The wire mode and the Extreme flag for a choice. */
export function wireOf(m: UiMode): { mode: SessionInfo["mode"]; extreme: boolean; extremeMax?: true } {
  return m === "extremeMax"
    ? { mode: "default", extreme: true, extremeMax: true }
    : m === "extreme"
      ? { mode: "default", extreme: true }
      : { mode: m, extreme: false }
}
