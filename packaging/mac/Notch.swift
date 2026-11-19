// What waits on you, beside the notch (owner, 14 Nov). A small panel on the screen you are using, with
// apps/web/src/surfaces/NotchMac.tsx in it: at the notch's right when that screen has one, else under its menu bar in
// the middle (16 Nov: on an external display it was out of sight, beside the laptop's notch). It follows the pointer
// from screen to screen while it shows. It is beside the notch, not over it, so another app can keep the notch
// itself. It shows only while something waits, never makes Codehouse the active app, and is not on the lock screen. Its Deny and Allow once are the
// Approvals rows' own, decided as on the desktop; anything that needs reading opens the main window.
import AppKit

/// A panel without a title bar can take a click without becoming the active app.
private final class WingPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  /// Where it is put, up against the top of the screen beside the notch, not moved down below the menu bar.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

final class NotchWing: PageWindow {
  /// Called with a request's id when it is to be shown in full, in the main window.
  var onOpen: (String) -> Void = { _ in }
  /// Called with each message the page sends, for --check.
  var onSaid: (String) -> Void = { _ in }
  private var size = NSSize(width: 60, height: 32)
  private var shown = false
  private var follow: Timer?
  private var placedBy: Bool?

  init() {
    let panel = WingPanel(
      contentRect: NSRect(x: 0, y: 0, width: 60, height: 32), styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered, defer: false)
    panel.title = "Codehouse: waiting on you"
    // Over the menu bar, as the notch is, and at the level of another notch app's shape (Vorssaint's is 26), so nothing in
    // the menu bar's band is over it and takes its clicks (19 Nov: at the top beside Vorssaint, it could not be clicked).
    panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.hasShadow = false
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    super.init(window: panel, firstClick: true)
    // PageWindow gives every window its dark ground; this one is clear, so the wing's own rounded shape shows (19 Nov:
    // it sat on a black square). Clear, a window passes clicks through where it draws nothing, and a web view draws in
    // another process, so it is told to take them all: it is only ever as big as the wing or the list.
    panel.backgroundColor = .clear
    panel.ignoresMouseEvents = false
    // A clear page, not white round the wing and the list (19 Nov). WKWebView's setter is _setDrawsBackground:, which
    // key-value coding finds for drawsBackground; the check had asked for setDrawsBackground:, so it was never set.
    if web.responds(to: Selector(("_setDrawsBackground:"))) || web.responds(to: Selector(("setDrawsBackground:"))) {
      web.setValue(false, forKey: "drawsBackground")
    }
    web.underPageBackgroundColor = .clear
    web.pageZoom = 1
    panel.contentView = web
    onMessage = { [weak self] m in self?.said(m) }
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  func prepare(_ readyUrl: String) {
    putAway()
    placedBy = nil
    load(readyUrl, query: "?view=notch")
  }

  func putAway() {
    window.orderOut(nil)
    shown = false
    follow?.invalidate()
    follow = nil
  }

  private func said(_ m: String) {
    onSaid(m)
    if m == "notch:hide" {
      putAway()
    } else if m.hasPrefix("notch:size:") {
      let p = m.dropFirst("notch:size:".count).split(separator: ":").compactMap { Double($0) }
      guard p.count == 2, p[0] > 0, p[1] > 0 else { return }
      size = NSSize(width: min(p[0], 600), height: min(p[1], 640))
      place()
      if !shown {
        window.orderFrontRegardless()
        shown = true
        // Where you are now: checked once a second while it shows, and moved when you go to another screen.
        follow = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.place() }
      }
    } else if m.hasPrefix("notch-open:") {
      onOpen(String(m.dropFirst("notch-open:".count)))
    }
  }

  /// On the screen the pointer is on, at its top: against the notch's right edge, or right of another app's shape there
  /// (Vorssaint's, over the notch or in the middle of an external display's menu bar); with neither, top centre under
  /// the menu bar. The page is told which, for its shape.
  private func place() {
    let mouse = NSEvent.mouseLocation
    guard let s = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main else { return }
    let frame: NSRect
    let byNotch: Bool
    let screenTop = (NSScreen.screens.first?.frame.maxY ?? s.frame.maxY) - s.frame.maxY
    let windows = Self.topWindows()
    let start = s.safeAreaInsets.top > 0
      ? s.auxiliaryTopRightArea?.minX
      : NotchPlace.shapeStart(screenTop: screenTop, screenMinX: s.frame.minX, screenMaxX: s.frame.maxX, windows: windows)
    if let start {
      // Right of another notch app's shape, if one covers where it would be (NotchPlace.swift).
      let x = NotchPlace.wingX(
        notchRight: start, screenTop: screenTop, screenMinX: s.frame.minX, screenMaxX: s.frame.maxX,
        wingWidth: size.width, windows: windows)
      frame = NSRect(x: x, y: s.frame.maxY - size.height, width: size.width, height: size.height)
      byNotch = true
    } else {
      let area = s.visibleFrame
      frame = NSRect(x: area.midX - size.width / 2, y: area.maxY - size.height - 4, width: size.width, height: size.height)
      byNotch = false
    }
    if placedBy != byNotch {
      placedBy = byNotch
      tell(byNotch ? "notch-place:notch" : "notch-place:free")
    }
    if window.frame != frame { window.setFrame(frame, display: true) }
  }

  /// Every window on screen, as CGWindowList sees it: where it is and its level, never what is in it.
  private static func topWindows() -> [TopWindow] {
    let me = ProcessInfo.processInfo.processIdentifier
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    return (list ?? []).compactMap { w in
      guard let b = w[kCGWindowBounds as String] as? [String: CGFloat], let x = b["X"], let y = b["Y"], let width = b["Width"]
      else { return nil }
      return TopWindow(
        x: x, y: y, width: width, layer: w[kCGWindowLayer as String] as? Int ?? 0,
        mine: (w[kCGWindowOwnerPID as String] as? pid_t) == me)
    }
  }

  @objc private func screensChanged() {
    if shown { place() }
  }
}
