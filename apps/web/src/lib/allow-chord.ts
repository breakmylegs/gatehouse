import { useRef, useState } from "react"

/**
 * D-092, safe keyboard approvals: a High or Severe request is never allowed by one key. Ctrl+Enter (or Enter on the
 * Allow button) only arms it; a second press within two seconds allows it. Below High, Ctrl+Enter allows as before.
 * A pointer click on Allow is a deliberate act and is unchanged.
 */
export const CHORD_MS = 2000

export type ChordKey = "ctrl-enter" | "enter" | "button-key"

/** One key press: whether it allows now, and when the chord was armed (undefined when it is not armed). */
export function chordStep(armedAt: number | undefined, key: ChordKey, high: boolean, now: number): { allow: boolean; armedAt?: number } {
  if (!high) return { allow: key !== "enter" }
  if (armedAt !== undefined && now - armedAt <= CHORD_MS) return { allow: true }
  if (key === "enter") return { allow: false }
  return { allow: false, armedAt: now }
}

/** The chord for one card: press() says whether to allow; armed says whether to show "Press Enter again". */
export function useAllowChord(high: boolean, now: () => number = Date.now) {
  const at = useRef<number | undefined>(undefined)
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const press = (key: ChordKey): boolean => {
    const r = chordStep(at.current, key, high, now())
    at.current = r.armedAt
    clearTimeout(timer.current)
    setArmed(r.armedAt !== undefined)
    if (r.armedAt !== undefined)
      timer.current = setTimeout(() => {
        at.current = undefined
        setArmed(false)
      }, CHORD_MS)
    return r.allow
  }
  return { armed, press }
}
