import { isMac } from "./platform-mac"

/**
 * The owner, 25 Nov: "I like the apple style interface that David's commits have done. I want the apple style
 * interface on the windows version." The Mac's look (mac-standard.css: the palette, type, controls, the glass sidebar,
 * menus and notices, the grouped rows) on Windows too, as Apple style, which is the usual look; Codehouse is the look
 * it had before. On a Mac the Mac's own look always applies (data-platform="mac"), so the choice is not offered there.
 * Windows high contrast takes over from either: while it is on, the page shows the colours you set in Windows.
 */
export type Look = "apple" | "codehouse"
export const DEFAULT_LOOK: Look = "apple"
const KEY = "codeh:look"
export const LOOK_EVENT = "codeh-look"

/** The look you chose, read tolerantly: anything else is the usual one. */
export function readLook(): Look {
  try {
    const v = localStorage.getItem(KEY)
    return v === "codehouse" || v === "apple" ? v : DEFAULT_LOOK
  } catch {
    return DEFAULT_LOOK
  }
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
