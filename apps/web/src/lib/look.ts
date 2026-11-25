import { isMac } from "./platform-mac"

/**
 * The owner, 25 Nov: "I like the apple style interface that David's commits have done. I want the apple style
 * interface on the windows version." The Mac's look (mac-standard.css: the palette, type, controls, the glass sidebar,
 * menus and notices, the grouped rows) on Windows too. Later the same day: "I want as little drift between the mac and
 * windows version as possible. Mac features will always take the priority when it comes to menu layout, themes and
 * style." So Windows always has it, and the Codehouse look is no longer offered (a kept "codehouse" is read and set
 * aside). Windows high contrast still takes over: while it is on, the page shows the colours you set in Windows.
 */
export type Look = "apple" | "codehouse"
export const DEFAULT_LOOK: Look = "apple"
const KEY = "codeh:look"
export const LOOK_EVENT = "codeh-look"

/** The look: always Apple style now. What an earlier version kept is read tolerantly and set aside. */
export function readLook(): Look {
  return DEFAULT_LOOK
}

export function saveLook(look: Look): void {
  try {
    localStorage.setItem(KEY, look)
  } catch {
    // private mode: the look lasts until the window closes
  }
  window.dispatchEvent(new Event(LOOK_EVENT))
}

const forcedColours = (): boolean => globalThis.matchMedia?.("(forced-colors: active)").matches === true

/** Marks the page for the look: Apple style on Windows, unless high contrast is on. A Mac is marked by its platform. */
export function applyLook(
  root: HTMLElement = document.documentElement,
  look: Look = readLook(),
  forced: boolean = forcedColours(),
  mac: boolean = isMac(),
): void {
  if (!mac && look === "apple" && !forced) root.dataset.look = "apple"
  else delete root.dataset.look
}

/** Applies the look now, and again when you choose another or turn high contrast on or off. */
export function watchLook(root: HTMLElement = document.documentElement): () => void {
  const again = () => applyLook(root)
  again()
  const q = globalThis.matchMedia?.("(forced-colors: active)")
  q?.addEventListener?.("change", again)
  window.addEventListener(LOOK_EVENT, again)
  return () => {
    q?.removeEventListener?.("change", again)
    window.removeEventListener(LOOK_EVENT, again)
  }
}
