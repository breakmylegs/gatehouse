import type { Detail } from "./paneView"

/**
 * How the window looks, from Settings, General, Appearance (owner, 4 Nov: Claude's desktop app has these). Kept in the
 * window's storage like the theme, applied as CSS variables on the page, and never sent to the Host.
 */
export interface Appearance {
  /** How wide a conversation runs. */
  width: "narrow" | "wide"
  /** "reduced" turns movement off whatever Windows says; "system" follows Windows. */
  motion: "system" | "reduced"
  /** A monospace font for code, files, diffs and the terminal; empty for the usual Cascadia Mono. */
  codeFont: string
  /** The code text size in pixels; 0 for each place's usual size. */
  codeSize: number
  /** The text size a pane opens at, as a percentage, until you change that pane. */
  textSize: 90 | 100 | 115 | 130
  /** How much of the work a pane shows when it opens, until you change that pane. */
  detail: Detail
}

export const DEFAULT_APPEARANCE: Appearance = {
  width: "narrow",
  motion: "system",
  codeFont: "",
  codeSize: 0,
  textSize: 100,
  detail: "normal",
}

export const CODE_SIZES = [0, 11, 12, 13, 14, 15, 16] as const
const KEY = "gatehouse.appearance"
const WIDTH = { narrow: "860px", wide: "1200px" } as const

/** A font name with nothing that could break out of the CSS value: letters, digits, spaces and hyphens. */
export const cleanFont = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)

/** What was kept, read tolerantly: anything unknown or unreadable is the usual look. */
export function readAppearance(): Appearance {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Appearance> | null
    const d = DEFAULT_APPEARANCE
    return {
      width: v?.width === "wide" ? "wide" : d.width,
      motion: v?.motion === "reduced" ? "reduced" : d.motion,
      codeFont: typeof v?.codeFont === "string" ? cleanFont(v.codeFont) : d.codeFont,
      codeSize: CODE_SIZES.includes(v?.codeSize as (typeof CODE_SIZES)[number])
        ? (v!.codeSize as number)
        : d.codeSize,
      textSize: [90, 100, 115, 130].includes(v?.textSize as number)
        ? (v!.textSize as Appearance["textSize"])
        : d.textSize,
      detail: v?.detail === "summary" || v?.detail === "verbose" ? v.detail : d.detail,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** Puts it on the page: the transcript width, the code font and size, and whether movement is off. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  root.style.setProperty("--transcript-width", WIDTH[a.width])
  const font = cleanFont(a.codeFont)
  if (font)
    root.style.setProperty(
      "--font-code",
      `"${font}", "Cascadia Mono", Consolas, ui-monospace, monospace`,
    )
  else root.style.removeProperty("--font-code")
  if (a.codeSize) root.style.setProperty("--code-size", `${a.codeSize}px`)
  else root.style.removeProperty("--code-size")
  if (a.codeSize) root.dataset.codeSize = ""
  else delete root.dataset.codeSize
  if (a.motion === "reduced") root.dataset.motion = "reduced"
  else delete root.dataset.motion
}

export function saveAppearance(a: Appearance): void {
  try {
    const same = (Object.keys(DEFAULT_APPEARANCE) as Array<keyof Appearance>).every(
      (k) => a[k] === DEFAULT_APPEARANCE[k],
    )
    if (same) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(a))
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
  applyAppearance(a)
}
