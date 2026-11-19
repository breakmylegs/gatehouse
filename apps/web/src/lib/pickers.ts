import { aboveCap } from "@gatehouse/shared/ws-protocol"
import { EFFORTS, type EffortId } from "./modes"

/**
 * T-107: the session in front's pickers from the keyboard. Alt+M, Alt+E and Alt+O (or your own keys, T-071) open the
 * model, effort and mode pickers; Ctrl+Alt+Up and Down move the effort one step, never above the cap in Settings.
 */
export type Picker = "model" | "effort" | "mode"

/** The effort one step up or down from where it is (the model's default counts as Medium), within the cap. */
export function stepEffort(current: EffortId | undefined, by: 1 | -1, cap?: EffortId): EffortId | undefined {
  const ids = EFFORTS.map((e) => e.id)
  const at = ids.indexOf(current ?? "medium")
  const next = ids[at + by]
  if (!next || aboveCap(next, cap)) return undefined
  return next
}

/** Opens a session's picker: focuses its list and shows the choices where the browser can. */
export function openPicker(sessionId: string, which: Picker, root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLSelectElement>(`select[data-picker="${which}"][data-session="${CSS.escape(sessionId)}"]`)
  if (!el || el.disabled) return false
  el.focus()
  try {
    el.showPicker?.()
  } catch {
    // Not allowed here (no user gesture in a test, an older browser): focused is enough, the arrows choose.
  }
  return true
}
