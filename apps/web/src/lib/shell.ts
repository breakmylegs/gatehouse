/**
 * When Gatehouse runs in its own window (Codehouse.exe, a WebView2 host) the page and the window talk with short messages.
 * The page asks for attention with a fixed word and never any detail, because a balloon can show on a locked screen
 * or be mirrored. The quick prompt (W1-15) says when to put it away and what it sent, and the main page says which
 * shortcut opens it. These stay on this computer. In a plain browser there is no host and none of this does anything.
 */
interface WebViewHost {
  postMessage(message: string): void
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void
  removeEventListener(type: "message", listener: (e: { data: unknown }) => void): void
}

const host = () => (globalThis as { chrome?: { webview?: WebViewHost } }).chrome?.webview

/** Whether the page is in the Codehouse window rather than a browser. */
export const inShell = () => host() !== undefined

export type ShellMessage =
  | "attention"
  | "voice"
  | "quick-close"
  | `quick-open:${string}`
  | `hotkey:${string}`
  // B16: a session in a window of its own, and that window closing itself.
  | `popout:${string}`
  | "pane-close"
  // CH-08: a picture of part of the screen, or of the window you were in, from the quick prompt.
  | "capture:region"
  | "capture:window"

export function tellShell(message: ShellMessage): void {
  try {
    host()?.postMessage(message)
  } catch {
    /* the window is going away */
  }
}

/** Calls back with each message the window sends; returns how to stop. */
export function onShell(listener: (message: string) => void): () => void {
  const h = host()
  if (!h) return () => undefined
  const each = (e: { data: unknown }) => {
    if (typeof e.data === "string") listener(e.data)
  }
  h.addEventListener("message", each)
  return () => h.removeEventListener("message", each)
}
