// The quick prompt (W1-15) on a Mac: a small panel over whatever you are doing, opened by its shortcut or the menu bar,
// that starts a chat or messages the session you were working in. It is loaded hidden once the main window has
// loaded, so opening it only shows it. It does not bring Codehouse's other windows forward: the app you were in
// stays where it is, and Esc, or clicking elsewhere, puts the panel away and leaves you there. The Mac counterpart of
// packaging/Overlay.cs.
import AppKit

/// A panel without a title bar can only take typing if it says so.
private final class KeyPanel: NSPanel {
  override var canBecomeKey: Bool { true }
}

final class QuickPanel: PageWindow {
  private(set) var ready = false
  /// The app you were in when it opened, for "the window you were in".
  private var before: NSRunningApplication?
  private var capturing = false
  /// Told what was sent (a little JSON: the session and your words) so the main window shows it.
  var onSent: (String) -> Void = { _ in }

  init() {
    let panel = KeyPanel(
      contentRect: NSRect(x: 0, y: 0, width: 680, height: 300),
      styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
      backing: .buffered, defer: false)
    panel.title = "Codehouse quick prompt"
    panel.level = .floating
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.hasShadow = true
    panel.isMovableByWindowBackground = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
    super.init(window: panel)
    let content = NSView()
    content.wantsLayer = true
    content.layer?.cornerRadius = 12
    content.layer?.masksToBounds = true
    content.layer?.backgroundColor = Self.night.cgColor
    web.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(web)
    NSLayoutConstraint.activate([
      web.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      web.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      web.topAnchor.constraint(equalTo: content.topAnchor),
      web.bottomAnchor.constraint(equalTo: content.bottomAnchor),
    ])
    panel.contentView = content
    panel.backgroundColor = .clear
    panel.isOpaque = false
    onMessage = { [weak self] m in self?.said(m) }
  }

  func prepare(_ readyUrl: String) {
    ready = false
    load(readyUrl, query: "?view=quick")
  }

  override func pageLoaded() { ready = true }
  override func pageFailed(_ why: String) { ready = false }

  private func said(_ m: String) {
    if m == "quick-close" {
      putAway()
    } else if m == "capture:region" || m == "capture:window" {
      takePicture(window: m == "capture:window")
    } else if m.hasPrefix("quick-open:") {
      putAway()
      onSent(String(m.dropFirst("quick-open:".count)))
    }
  }

  /// Shows it a quarter of the way down the screen the pointer is on, over the app you are in.
  func open() {
    let front = NSWorkspace.shared.frontmostApplication
    before = front?.processIdentifier == ProcessInfo.processInfo.processIdentifier ? nil : front
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    if let area = screen?.visibleFrame {
      let size = window.frame.size
      window.setFrameOrigin(NSPoint(x: area.midX - size.width / 2, y: area.maxY - area.height / 4 - size.height))
    }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(web)
    tell("quick-shown")
  }

  func putAway() {
    window.orderOut(nil)
  }

  /// Clicking somewhere else puts it away, except while a picture is being taken.
  @objc func windowDidResignKey(_ notification: Notification) {
    if !capturing { putAway() }
  }

  /// CH-08: the panel steps aside while the picture is taken, so it is not in it.
  private func takePicture(window wanted: Bool) {
    capturing = true
    let id: CGWindowID? = wanted ? (before.flatMap { ScreenCapture.frontWindow(of: $0.processIdentifier) }) : nil
    if wanted && id == nil {
      capturing = false
      return tell("capture-none")
    }
    putAway()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [self] in
      ScreenCapture.take(window: id) { [self] png in
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)
        capturing = false
        tell(png.map { "captured:" + $0.base64EncodedString() } ?? "capture-none")
      }
    }
  }
}
