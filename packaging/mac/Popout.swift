// A session in a window of its own (B16): the same page as the main window, at ?view=pane&session=<id>, so the same
// token, Host and Origin checks apply. It only ever shows Codehouse's own page. Closing it puts the session back in
// the main window. The Mac counterpart of packaging/Popout.cs.
import AppKit

final class PopoutWindow: PageWindow {
  let session: String
  /// Called when it closes, so the main window shows the session again.
  var onClose: () -> Void = {}
  private var titleWatch: NSKeyValueObservation?

  /// A session id as the Host makes them: nothing else becomes part of the address.
  static func isSessionId(_ s: String) -> Bool {
    s.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil
  }

  init(session: String) {
    self.session = session
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 900, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    super.init(window: window)
    window.title = "Codehouse"
    window.contentView = web
    startSize(NSSize(width: 900, height: 760), minimum: NSSize(width: 420, height: 360))
    web.pageZoom = Self.savedZoom
    titleWatch = web.observe(\.title) { [weak self] web, _ in
      if let t = web.title, !t.isEmpty { self?.window.title = t }
    }
    onMessage = { [weak self] m in
      if m == "pane-close" { self?.window.close() }
    }
  }

  func open(_ ready: String) {
    load(ready, query: "?view=pane&session=\(session)")
    window.makeKeyAndOrderFront(nil)
  }

  // @objc: the window delegate is declared on PageWindow, so Swift would not expose this subclass's method by itself.
  @objc func windowWillClose(_ notification: Notification) {
    titleWatch = nil
    onClose()
  }
}
