import { readAppearance } from "./appearance"

/**
 * How one session's conversation is shown: its text size and how close the messages sit (owner, 31 Oct, O5). Kept per
 * session, by its id, which a restart or an update keeps, so each pane comes back as you left it.
 */
export type Density = "comfortable" | "compact"
/**
 * How much of the work shows (W1-12): Summary keeps what you say, what Claude says, errors, why-lines and anything
 * refused or waiting on you; Normal folds each run of tool calls into a line; Verbose opens every call and thinking.
 */
export type Detail = "summary" | "normal" | "verbose"

export interface PaneView {
  /** The text size as a percentage of the usual 14 px. */
  size: number
  density: Density
  detail: Detail
}

/** The sizes the menu steps through. */
export const SIZES = [90, 100, 115, 130] as const

export const DEFAULT_VIEW: PaneView = { size: 100, density: "comfortable", detail: "normal" }

/** How a pane opens until you change it: the text size and detail chosen in Settings, General, Appearance. */
export function defaultView(): PaneView {
  const a = readAppearance()
  return { size: a.textSize, density: "comfortable", detail: a.detail }
}

const key = (sessionId: string) => `gatehouse.pane.${sessionId}`

/** What was kept for this session, or the usual look. Anything unreadable is the usual look. */
export function readPaneView(sessionId: string): PaneView {
  const base = defaultView()
  try {
    const v = JSON.parse(localStorage.getItem(key(sessionId)) ?? "null") as Partial<PaneView> | null
    return {
      size: SIZES.includes(v?.size as (typeof SIZES)[number]) ? (v!.size as number) : base.size,
      density: v?.density === "compact" ? "compact" : "comfortable",
      // Kept by a newer version; an older one never wrote it and reads the rest as before.
      detail:
        v?.detail === "summary" || v?.detail === "verbose" || v?.detail === "normal"
          ? v.detail
          : base.detail,
    }
  } catch {
    return base
  }
}

export function savePaneView(sessionId: string, view: PaneView): void {
  try {
    // The usual look is not stored, so a session you never changed leaves nothing behind.
    const base = defaultView()
    if (view.size === base.size && view.density === base.density && view.detail === base.detail)
      localStorage.removeItem(key(sessionId))
    else localStorage.setItem(key(sessionId), JSON.stringify(view))
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
}

/** The next size up or down, or the same at the end of the list. */
export function stepSize(size: number, by: 1 | -1): number {
  const i = SIZES.indexOf(size as (typeof SIZES)[number])
  const at = i < 0 ? SIZES.indexOf(100) : i
  return SIZES[Math.min(SIZES.length - 1, Math.max(0, at + by))]!
}
