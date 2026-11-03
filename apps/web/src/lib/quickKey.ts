import { useSyncExternalStore } from "react"
import { useStore } from "../store"
import { inShell, onShell, tellShell } from "./shell"

/**
 * The quick prompt's shortcut (W1-15). The window registers it with Windows and says how that went: taken, it keeps
 * the one before and offers three free ones. Only one the window accepted is kept, in this window's storage.
 */
const KEY = "gatehouse.quickHotkey"
export const DEFAULT_HOTKEY = "Ctrl+Alt+Space"

export type HotkeyState =
  | { kind: "unknown" }
  | { kind: "ok"; text: string }
  | { kind: "off" }
  | { kind: "bad"; error: string }
  | { kind: "clash"; text: string; alternatives: string[] }

let state: HotkeyState = { kind: "unknown" }
const subs = new Set<() => void>()

export function savedHotkey(): string {
  try {
    return localStorage.getItem(KEY) ?? DEFAULT_HOTKEY
  } catch {
    return DEFAULT_HOTKEY
  }
}

function keep(text: string) {
  try {
    localStorage.setItem(KEY, text)
  } catch {
    // storage blocked: the shortcut lasts until Codehouse closes
  }
}

/** What the window said about a shortcut, or undefined for a message about something else. */
export function readHotkeyReply(m: string): HotkeyState | undefined {
  if (m === "hotkey-off") return { kind: "off" }
  if (m.startsWith("hotkey-ok:")) return { kind: "ok", text: m.slice(10) }
  if (m.startsWith("hotkey-bad:")) return { kind: "bad", error: m.slice(11) }
  if (m.startsWith("hotkey-clash:")) {
    const [text = "", ...alternatives] = m.slice(13).split("|")
    return { kind: "clash", text, alternatives: alternatives.filter(Boolean) }
  }
  return undefined
}

/** Asks the window for this shortcut, or for none with an empty text. */
export function chooseHotkey(text: string): void {
  tellShell(`hotkey:${text.trim()}`)
}

/**
 * The main window, once: tells the window the saved shortcut, and listens for its answers and for what the quick
 * prompt sent, which it shows (your words, and the session they went to).
 */
export function startShell(): () => void {
  if (!inShell()) return () => undefined
  const off = onShell((m) => {
    const s = readHotkeyReply(m)
    if (s) {
      if (s.kind === "ok") keep(s.text)
      if (s.kind === "off") keep("")
      state = s
      subs.forEach((f) => f())
      return
    }
    // B16: a session's own window closed, so the session goes back into the main window, beside what is there.
    if (m.startsWith("popin:")) {
      const id = m.slice(6)
      const st = useStore.getState()
      if (!st.sessions[id]) return
      if (!st.panes.includes(id)) st.openBeside(id)
      return
    }
    if (m.startsWith("open-session:")) {
      try {
        const sent = JSON.parse(m.slice(13)) as { session?: unknown; text?: unknown }
        if (typeof sent.session !== "string" || typeof sent.text !== "string") return
        const st = useStore.getState()
        st.addUserText(sent.session, sent.text)
        st.selectSession(sent.session)
        st.setRoute("workspace")
      } catch {
        // not a message this version understands
      }
    }
  })
  chooseHotkey(savedHotkey())
  return off
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
export const useHotkeyState = () => useSyncExternalStore(subscribe, () => state)
