/**
 * When Gatehouse runs in its own window (Codehouse.exe, a WebView2 host) the page and the window talk with short messages.
 * The page asks for attention with a fixed word and never any detail, because a balloon can show on a locked screen
 * or be mirrored. The quick prompt (W1-15) says when to put it away and what it sent, and the main page says which
 * shortcut opens it. These stay on this computer. In a plain browser there is no host and none of this does anything.
 */
interface WebViewHost {
  postMessage(message: string): void
  /** WebView2: a message with files the window can read the paths of (a dropped folder, T-005). */
  postMessageWithAdditionalObjects?(message: string, objects: ArrayLike<File>): void
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
  // Mac fork: the wing beside the notch (NotchMac.tsx): its size, hiding it, and a request to open in the window.
  | "notch:hide"
  | `notch:size:${number}:${number}`
  | `notch-open:${string}`

export function tellShell(message: ShellMessage): void {
  try {
    host()?.postMessage(message)
  } catch {
    /* the window is going away */
  }
}

/**
 * T-005: a folder dropped on the sidebar. A page is never given a dropped item's path, so the files go to the window,
 * which reads the folder's real path (WebView2's postMessageWithAdditionalObjects) and answers with the same
 * open-folder message as a folder opened from a terminal (T-002). "no-shell" in a browser, CNW or a window without it.
 */
export function dropToShell(files: ArrayLike<File>): "sent" | "no-shell" {
  const h = host()
  if (!h?.postMessageWithAdditionalObjects || !files.length) return "no-shell"
  try {
    h.postMessageWithAdditionalObjects("folder-drop", files)
    return "sent"
  } catch {
    return "no-shell"
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
