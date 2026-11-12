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
    web.pageZoom = Self.savedZoom
    web.isHidden = true

    // Standard macOS (owner, 12 Nov): the title bar takes the page's own ground, so it reads as one toolbar with it,
    // and the Mac's sidebar material sits behind the page, which leaves its sidebar column clear to show it
    // (mac-standard.css, under data-mac-vibrancy). With Reduce transparency on, macOS makes the material opaque.
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.backgroundColor = Self.ground
    let material = NSVisualEffectView()
    material.material = .sidebar
    material.blendingMode = .behindWindow
    material.state = .followsWindowActiveState
    if web.responds(to: Selector(("setDrawsBackground:"))) { web.setValue(false, forKey: "drawsBackground") }
    web.underPageBackgroundColor = .clear
    web.configuration.userContentController.addUserScript(
      WKUserScript(source: Self.vibrancyScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))

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
  }

  override func pageLoaded() {
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
        checkBridge { [self] bridgeOk, said in onLoaded(bridgeOk, text + "\n" + said) }
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
