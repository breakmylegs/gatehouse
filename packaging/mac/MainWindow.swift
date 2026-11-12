// The Codehouse window on a Mac: the interface, with the start-up picture while the Host starts. What it shares with
// the other windows (the guard, the Mac's own dialogs, the messages with the page) is in Page.swift.
import AppKit
import WebKit

final class MainWindow: PageWindow {
  private let splash = NSView()
  private let splashText = NSTextField(wrappingLabelWithString: "")
  private let spinner = NSProgressIndicator()
  private var loaded = false
  private let check: Bool
  /// Called once the page has loaded (and, in check mode, with what it showed).
  var onLoaded: (_ ok: Bool, _ detail: String) -> Void = { _, _ in }

  /// The page's ground (--c-bg in mac-standard.css), light or dark with the window's appearance.
  static let ground = NSColor(name: "Codehouse ground") { appearance in
    appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      ? NSColor(srgbRed: 0x1e / 255, green: 0x1e / 255, blue: 0x20 / 255, alpha: 1)
      : .white
  }

  /// Marks the page as having the Mac's material behind it, and says which theme it shows, whenever that changes,
  /// so the title bar and the material follow the page (the page's own choice can differ from the Mac's).
  static let vibrancyScript = """
    document.documentElement.setAttribute("data-mac-vibrancy", "");
    (() => {
      let last = "";
      const say = () => {
        const t = document.documentElement.dataset.theme || "";
        if (t && t !== last && window.webkit) { last = t; window.webkit.messageHandlers.codehouse.postMessage("theme:" + t) }
      };
      new MutationObserver(say).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      document.addEventListener("DOMContentLoaded", say);
    })();
    """

  /// The title bar's height and how far right the traffic lights reach, in points.
  private(set) var titlebar: CGFloat = 0
  private(set) var lights: CGFloat = 0

  /// The page's half of the merged toolbar: it marks the page so mac-standard.css lays the toolbar out beside the
  /// traffic lights at the title bar's height, and where the toolbar is empty (no control under the pointer) a press
  /// asks the window to follow the mouse, and a double-click does what System Settings says a title bar's does.
  static let titlebarScript = """
    document.documentElement.setAttribute("data-mac-titlebar", "");
    (() => {
      const busy = (t) => !t || !t.closest || !!t.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="option"], [contenteditable], [tabindex]:not([tabindex="-1"]), .menu, .kill-confirm');
      Object.defineProperty(window, "__codehouseBusy", { value: busy });
      const post = (m) => window.webkit && window.webkit.messageHandlers.codehouse.postMessage(m);
      document.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || e.detail > 1 || e.clientY > (window.__codehouseBand || 0) || busy(e.target)) return;
        e.preventDefault();
        post("drag-window");
      }, true);
      document.addEventListener("dblclick", (e) => {
        if (e.clientY > (window.__codehouseBand || 0) || busy(e.target)) return;
        post("zoom-window");
      }, true);
    })();
    """

  /// The title bar's measures in CSS pixels at the page's zoom, for the page.
  private func titlebarValues() -> String {
    let z = max(0.5, web.pageZoom)
    let band = Int((titlebar / z).rounded()), inset = Int((lights / z).rounded())
    return """
      ;window.__codehouseBand = \(band);
      document.documentElement.style.setProperty("--mac-titlebar", "\(band)px");
      document.documentElement.style.setProperty("--mac-lights", "\(inset)px");
      """
  }

  init(check: Bool) {
    self.check = check
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    super.init(window: window)
    window.title = "Codehouse"
    startSize(NSSize(width: 1320, height: 860), minimum: NSSize(width: 900, height: 600))
    // The size and place you left it at, then kept on one screen (Page.swift).
    if !check { window.setFrameAutosaveName("Codehouse main window") }
    fitToScreen()
    web.pageZoom = check ? 1 : Self.savedZoom
    web.isHidden = true

    // Standard macOS (owner, 12 Nov): the title bar takes the page's own ground, so it reads as one toolbar with it,
    // and the Mac's sidebar material sits behind the page, which leaves its sidebar column clear to show it
    // (mac-standard.css, under data-mac-vibrancy). With Reduce transparency on, macOS makes the material opaque.
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.backgroundColor = Self.ground
    // The toolbar is the title bar, as in macOS 26's own apps: the page runs under a transparent compact toolbar and
    // draws its toolbar beside the traffic lights. Clicks there reach the page (--check clicks Stop everything under
    // it), so the page asks for a window drag where the toolbar is empty (titlebarScript).
    window.styleMask.insert(.fullSizeContentView)
    let bar = NSToolbar(identifier: "Codehouse")
    bar.displayMode = .iconOnly
    window.toolbar = bar
    window.toolbarStyle = .unifiedCompact
    window.titlebarSeparatorStyle = .none
    titlebar = window.frame.height - window.contentLayoutRect.height
    lights = (window.standardWindowButton(.zoomButton)?.frame.maxX ?? 68) + 14
    let material = NSVisualEffectView()
    material.material = .sidebar
    material.blendingMode = .behindWindow
    material.state = .followsWindowActiveState
    if web.responds(to: Selector(("setDrawsBackground:"))) { web.setValue(false, forKey: "drawsBackground") }
    web.underPageBackgroundColor = .clear
    web.configuration.userContentController.addUserScript(
      WKUserScript(source: Self.vibrancyScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web.configuration.userContentController.addUserScript(
      WKUserScript(
        source: Self.titlebarScript + titlebarValues(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

    let content = NSView()
    content.wantsLayer = true
    content.layer?.backgroundColor = Self.night.cgColor
    window.contentView = content
    for v in [material, web, splash] {
      v.translatesAutoresizingMaskIntoConstraints = false
      content.addSubview(v)
      NSLayoutConstraint.activate([
        v.leadingAnchor.constraint(equalTo: content.leadingAnchor),
        v.trailingAnchor.constraint(equalTo: content.trailingAnchor),
        v.topAnchor.constraint(equalTo: content.topAnchor),
        v.bottomAnchor.constraint(equalTo: content.bottomAnchor),
      ])
    }
    buildSplash()
  }

  private func buildSplash() {
    splash.wantsLayer = true
    splash.layer?.backgroundColor = Self.night.cgColor
    if let file = Bundle.main.url(forResource: "splash", withExtension: "png"), let image = NSImage(contentsOf: file) {
      let picture = NSImageView(image: image)
      picture.imageScaling = .scaleProportionallyUpOrDown
      picture.translatesAutoresizingMaskIntoConstraints = false
      // The picture gives way to the window, never the window to the picture: at its own size (1672 by 941) and at
      // most 70% by 60% of the window, it made the window 2389 by 1601, larger than the screen.
      for axis in [NSLayoutConstraint.Orientation.horizontal, .vertical] {
        picture.setContentCompressionResistancePriority(.defaultLow, for: axis)
        picture.setContentHuggingPriority(.defaultLow, for: axis)
      }
      splash.addSubview(picture)
      NSLayoutConstraint.activate([
        picture.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
        picture.centerYAnchor.constraint(equalTo: splash.centerYAnchor, constant: -40),
        picture.widthAnchor.constraint(lessThanOrEqualTo: splash.widthAnchor, multiplier: 0.7),
        picture.heightAnchor.constraint(lessThanOrEqualTo: splash.heightAnchor, multiplier: 0.6),
      ])
    }
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.appearance = NSAppearance(named: .darkAqua)
    spinner.startAnimation(nil)
    splashText.textColor = NSColor(white: 0.85, alpha: 1)
    splashText.font = .systemFont(ofSize: 13)
    splashText.alignment = .center
    splashText.isSelectable = true
    let row = NSStackView(views: [spinner, splashText])
    row.orientation = .horizontal
    row.alignment = .firstBaseline
    row.spacing = 8
    row.translatesAutoresizingMaskIntoConstraints = false
    splash.addSubview(row)
    NSLayoutConstraint.activate([
      row.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
      row.bottomAnchor.constraint(equalTo: splash.bottomAnchor, constant: -48),
      row.widthAnchor.constraint(lessThanOrEqualTo: splash.widthAnchor, multiplier: 0.8),
    ])
    say("Starting Codehouse")
  }

  /// What is happening while it starts, shown under the picture.
  func say(_ text: String) {
    splashText.stringValue = text
  }

  /// Shows the start-up picture again with what went wrong, and stops the spinner.
  func fail(_ text: String) {
    splash.isHidden = false
    web.isHidden = true
    spinner.stopAnimation(nil)
    spinner.isHidden = true
    splashText.textColor = NSColor(srgbRed: 1, green: 0.59, blue: 0.55, alpha: 1)
    splashText.alignment = .left
    say(text)
  }

  func open(_ ready: String) {
    loaded = false
    say("Opening the window")
    load(ready)
  }

  /// After a restart: the start-up picture until the new Host is ready.
  func showStarting(_ text: String) {
    splash.isHidden = false
    web.isHidden = true
    spinner.isHidden = false
    spinner.startAnimation(nil)
    splashText.textColor = NSColor(white: 0.85, alpha: 1)
    splashText.alignment = .center
    say(text)
  }

  func zoom(by step: CGFloat?) {
    web.pageZoom = step.map { min(3, max(0.5, web.pageZoom + $0)) } ?? 1
    Self.savedZoom = web.pageZoom
    web.evaluateJavaScript(titlebarValues(), completionHandler: nil)
  }

  // MARK: the toolbar as a title bar

  /// The page asked for a window drag (a press on the toolbar where no control is). The window follows the mouse
  /// until the button comes up; then WebKit is given the button-up, as it saw the press. `posting` is --check's own
  /// mouse, put in the queue first; a real drag reads the real one and stops at once if the button is already up.
  func dragWindow(posting: [NSEvent] = []) {
    if posting.isEmpty && NSEvent.pressedMouseButtons & 1 == 0 { return }
    for e in posting { NSApp.postEvent(e, atStart: false) }
    var last: NSPoint?
    while true {
      guard
        let e = window.nextEvent(
          matching: [.leftMouseDragged, .leftMouseUp], until: Date().addingTimeInterval(1), inMode: .eventTracking,
          dequeue: true)
      else {
        if posting.isEmpty && NSEvent.pressedMouseButtons & 1 != 0 { continue }
        break
      }
      if e.type == .leftMouseUp {
        web.mouseUp(with: e)
        break
      }
      let o = window.frame.origin
      let p = NSPoint(x: o.x + e.locationInWindow.x, y: o.y + e.locationInWindow.y)
      if let l = last { window.setFrameOrigin(NSPoint(x: o.x + p.x - l.x, y: o.y + p.y - l.y)) }
      last = p
    }
    if let screen = window.screen { window.setFrame(window.constrainFrameRect(window.frame, to: screen), display: true) }
  }

  /// A double-click on the empty toolbar does what System Settings, Desktop and Dock says a title bar's does.
  func titleDoubleClick() {
    switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
    case "Minimize": window.performMiniaturize(nil)
    case "None": break
    default: window.performZoom(nil)
    }
  }

  override func pageLoaded() {
    // The start script holds the zoom the window opened at; a page loaded since may be at another.
    web.evaluateJavaScript(titlebarValues(), completionHandler: nil)
    guard !loaded else { return }
    loaded = true
    if check { return checkPage() }
    splash.isHidden = true
    web.isHidden = false
    window.makeFirstResponder(web)
    onLoaded(true, "")
  }

  override func pageFailed(_ why: String) {
    if loaded { return }
    fail("The window could not load the Codehouse interface (\(why)).")
    onLoaded(false, why)
  }

  private func checkPage() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [self] in
      web.evaluateJavaScript(
        "JSON.stringify({title: document.title, children: (document.getElementById('root')||{children:[]}).children.length, text: document.body.innerText.slice(0,80), shell: !!(window.chrome && window.chrome.webview), glass: document.documentElement.dataset.platform === 'mac' && document.documentElement.hasAttribute('data-mac-vibrancy') && getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)' && !!document.querySelector('.rail') && getComputedStyle(document.querySelector('.rail')).backgroundColor !== 'rgba(0, 0, 0, 0)'})"
      ) { [self] result, error in
        let text = (result as? String) ?? "error: \(error?.localizedDescription ?? "no result")"
        // glass: the page is marked for the Mac's material, its ground is clear so the material shows, and the
        // sidebar still paints its tint over it (mac-standard.css).
        let ok =
          text.contains("Codehouse") && !text.contains("\"children\":0") && text.contains("\"shell\":true")
          && text.contains("\"glass\":true")
        if !ok { return onLoaded(false, text) }
        checkBridge { [self] bridgeOk, said in
          if !bridgeOk { return onLoaded(false, text + "\n" + said) }
          checkTitlebar { [self] barOk, barSaid in onLoaded(barOk, text + "\n" + said + "\n" + barSaid) }
        }
      }
    }
  }

  /// --check's own mouse for the toolbar drag, while the check runs.
  private(set) var checkDrag: [NSEvent]?

  private func mouse(_ type: NSEvent.EventType, _ p: NSPoint) -> NSEvent {
    NSEvent.mouseEvent(
      with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
      pressure: type == .leftMouseUp ? 0 : 1)!
  }

  /// The toolbar under the title bar works: Stop everything, which sits there, answers a click (its question opens,
  /// and a second click closes it again; Yes is never pressed), and a press on the empty toolbar drags the window.
  /// The window is ordered far off screen for this, so nothing shows. Which view a click reaches is AppKit's own
  /// hit test from the window's frame view, the title bar's views included, so the check holds whichever app you
  /// are using meanwhile; the click is then given to that view, as the window would give it.
  private func checkTitlebar(done: @escaping (Bool, String) -> Void) {
    window.orderFrontRegardless()
    // macOS keeps a window it brings forward on a screen; once it is in, it may go where the check wants it.
    window.setFrameOrigin(NSPoint(x: -20000, y: 200))
    // The page as you would have it, not under the start-up picture (check mode keeps it up until now).
    splash.isHidden = true
    web.isHidden = false
    let find = """
      (() => {
        const k = document.querySelector(".kill-switch");
        if (!k) return "";
        const r = k.getBoundingClientRect(), band = window.__codehouseBand || 0;
        let free = null;
        for (let x = innerWidth - 4; x > 0 && band; x -= 6) {
          const el = document.elementFromPoint(x, band / 2);
          if (el && !window.__codehouseBusy(el)) { free = [x, band / 2]; break }
        }
        return JSON.stringify({ kx: r.left + r.width / 2, ky: r.top + r.height / 2, band, free });
      })()
      """
    web.evaluateJavaScript(find) { [self] result, _ in
      guard let text = result as? String, let data = text.data(using: .utf8),
        let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let kx = m["kx"] as? Double, let ky = m["ky"] as? Double, let band = m["band"] as? Double
      else { return done(false, "Toolbar: Stop everything was not found") }
      guard ky < band else { return done(false, "Toolbar: Stop everything is not under the title bar (\(ky) of \(band))") }
      let h = window.frame.height
      let at = { (x: Double, y: Double) in NSPoint(x: x, y: h - y) }
      var routed = true
      // The view a press at p goes to, which must be the page; nil when it is not.
      let page = { [self] (p: NSPoint) -> NSView? in
        guard let frameView = window.contentView?.superview,
          let hit = frameView.hitTest(frameView.convert(p, from: nil)), hit === web || hit.isDescendant(of: web)
        else {
          routed = false
          return nil
        }
        return hit
      }
      let click = { [self] (p: NSPoint) in
        guard let v = page(p) else { return }
        v.mouseDown(with: mouse(.leftMouseDown, p))
        v.mouseUp(with: mouse(.leftMouseUp, p))
      }
      let open = "!!document.querySelector('.kill-confirm')"
      click(at(kx, ky))
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
        web.evaluateJavaScript(open) { [self] opened, _ in
          click(at(kx, ky))
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
            web.evaluateJavaScript(open) { [self] stillOpen, _ in
              let clicks = (opened as? Bool) == true && (stillOpen as? Bool) == false
              guard let free = m["free"] as? [Double], free.count == 2 else {
                return done(false, "Toolbar: Stop everything \(clicks ? "answers" : "did not answer"); no empty toolbar to drag")
              }
              // Five drag steps of 10 points; the window follows from the first, so it moves 40 (dragWindow).
              let f = at(free[0], free[1])
              checkDrag = (1...5).map { k in mouse(.leftMouseDragged, NSPoint(x: f.x + (k == 1 ? 10 : 20), y: f.y)) }
                + [mouse(.leftMouseUp, NSPoint(x: f.x + 20, y: f.y))]
              let start = window.frame.origin.x
              page(f)?.mouseDown(with: mouse(.leftMouseDown, f))
              DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [self] in
                checkDrag = nil
                let moved = window.frame.origin.x - start
                let ok = routed && clicks && abs(moved - 40) < 0.5
                done(
                  ok,
                  "Toolbar: clicks under the title bar \(routed ? "reach the page" : "do NOT reach the page"); Stop everything \(clicks ? "answers a click" : "did NOT answer a click"); the empty toolbar dragged the window \(Int(moved)) of 40 points"
                )
              }
            }
          }
        }
      }
    }
  }

  /// The bridge answers the top frame of Codehouse's own page and nothing else: a frame in the page gets no
  /// `chrome.webview`, and a message it sends through WebKit's handler directly is dropped.
  private func checkBridge(done: @escaping (Bool, String) -> Void) {
    var heard: [String] = []
    let before = onMessage
    onMessage = { m in heard.append(m) }
    let js = """
      const f = document.createElement("iframe");
      f.srcdoc = "<p>frame</p>";
      document.body.append(f);
      await new Promise((r) => f.addEventListener("load", r));
      const frameBridge = !!(f.contentWindow.chrome && f.contentWindow.chrome.webview);
      f.contentWindow.webkit.messageHandlers.codehouse.postMessage("check-frame");
      window.chrome.webview.postMessage("check-main");
      f.remove();
      return frameBridge;
      """
    web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { [self] result in
      let frameBridge: Bool
      switch result {
      case .success(let v): frameBridge = (v as? Bool) ?? true
      case .failure(let e): return done(false, "Bridge check failed: \(e.localizedDescription)")
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
        onMessage = before
        let ok = !frameBridge && heard == ["check-main"]
        done(ok, "Bridge: the frame has chrome.webview \(frameBridge); heard \(heard)")
      }
    }
  }
}
