import type { SessionInfo } from "@gatehouse/shared/ws-protocol"

/**
 * What a session's mode picker offers. Max approval is shown as a mode because that is how you choose it, but
 * underneath it is Manual (default) with every request that would ask you approved, audited and told to the phone.
 * O45 (owner, 20 Nov): one option, behaving exactly as Extreme max approval did; the rules-based kind is gone.
 */
export type UiMode = "auto" | "default" | "acceptEdits" | "plan" | "extreme"

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
    label: "Max approval",
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

export function uiModeOf(s: Pick<SessionInfo, "mode" | "extreme">): UiMode {
  return s.extreme ? "extreme" : s.mode
}

/** The wire mode and the Extreme flag for a choice. */
export function wireOf(m: UiMode): { mode: SessionInfo["mode"]; extreme: boolean; extremeMax?: true } {
  // An older Host still has the two kinds: the max flag keeps it on Max approval there too.
  return m === "extreme" ? { mode: "default", extreme: true, extremeMax: true } : { mode: m, extreme: false }
}
