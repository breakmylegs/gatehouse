import { useEffect, useState } from "react"

/**
 * T-053 (t3code review): which key sends a prompt. Enter (Shift+Enter for a new line), as before, or Ctrl+Enter (Command
 * on a Mac), so Enter makes new lines in a long prompt. Kept in this window, like the appearance choices.
 */
export type SendKey = "enter" | "mod-enter"

const KEY = "gatehouse.sendKey"
const EVENT = "codeh:send-key"

export function getSendKey(): SendKey {
  try {
    return localStorage.getItem(KEY) === "mod-enter" ? "mod-enter" : "enter"
  } catch {
    return "enter"
  }
}

export function setSendKey(k: SendKey): void {
  try {
    if (k === "enter") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, k)
  } catch {
    // Not kept, but used for now.
  }
  window.dispatchEvent(new Event(EVENT))
}

export function useSendKey(): SendKey {
  const [k, setK] = useState(getSendKey)
  useEffect(() => {
    const again = () => setK(getSendKey())
    window.addEventListener(EVENT, again)
    return () => window.removeEventListener(EVENT, again)
  }, [])
  return k
}

/** Whether this key press sends, for the choice in force. Never while an input method is composing. */
export function sends(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing?: boolean }, k: SendKey): boolean {
  if (e.key !== "Enter" || e.isComposing) return false
  // Enter: any Enter but Shift+Enter, as before (Ctrl+Enter sends too).
  return k === "enter" ? !e.shiftKey : e.ctrlKey || e.metaKey
}
