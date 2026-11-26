import { useEffect, useSyncExternalStore } from "react"
import type { RailMode } from "./railMode"

/**
 * O55 (owner, 25 Nov): the phone layout, by the size of the window (and a finger for a pointer), never by where the
 * page came from, so it is the same through Neighbourhood Watch, in a narrow window, on the Mac and on Windows. A phone
 * in portrait, or any window 640 px wide or less; a phone on its side, a coarse pointer in at most 960 by 520.
 * `docs/design/phone-layout.md` has the screens.
 */
export const PHONE_QUERY = "(max-width: 640px), (pointer: coarse) and (max-width: 960px) and (max-height: 520px)"

const query = (): MediaQueryList | undefined =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : undefined

const subscribe = (f: () => void) => {
  const q = query()
  q?.addEventListener?.("change", f)
  return () => q?.removeEventListener?.("change", f)
}
const isPhone = () => query()?.matches === true

/** Whether the phone layout is on now; it follows the window as it turns or is resized. */
export const usePhone = (): boolean => useSyncExternalStore(subscribe, isPhone, () => false)

/** Marks the root element, for the phone styles (`phone.css`) to apply only while the phone layout is on. */
export function usePhoneMark(phone: boolean): void {
  useEffect(() => {
    const root = document.documentElement
    if (phone) root.dataset.layout = "phone"
    else delete root.dataset.layout
  }, [phone])
}

/** The list the Sessions screen shows on a phone: coding sessions, or your Ask about code questions. */
let list: RailMode = "code"
const LIST_EVENT = "codeh:phone-list"
export function setPhoneList(side: RailMode): void {
  if (list === side) return
  list = side
  window.dispatchEvent(new Event(LIST_EVENT))
}
const subscribeList = (f: () => void) => {
  window.addEventListener(LIST_EVENT, f)
  return () => window.removeEventListener(LIST_EVENT, f)
}
export const usePhoneList = (): RailMode => useSyncExternalStore(subscribeList, () => list, () => "code")
