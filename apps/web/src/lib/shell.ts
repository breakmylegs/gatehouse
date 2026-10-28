/**
 * When Gatehouse runs in its own window (JCVC.exe, a WebView2 host) the window can flash the taskbar and show a
 * tray balloon. This is how the page asks: a short fixed word, never any detail, because a balloon can show on a locked
 * screen or be mirrored. In a plain browser there is no host and this does nothing.
 */
interface WebViewHost {
  postMessage(message: string): void
}

export function tellShell(message: "attention"): void {
  const host = (globalThis as { chrome?: { webview?: WebViewHost } }).chrome?.webview
  try {
    host?.postMessage(message)
  } catch {
    /* the window is going away */
  }
}
