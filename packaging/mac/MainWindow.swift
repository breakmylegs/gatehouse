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

  init(check: Bool) {
    self.check = check
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    super.init(window: window)
    window.title = "Codehouse"
    window.minSize = NSSize(width: 900, height: 600)
    window.center()
    if !check { window.setFrameAutosaveName("Codehouse main window") }
    web.isHidden = true

    let content = NSView()
    content.wantsLayer = true
    content.layer?.backgroundColor = Self.night.cgColor
    window.contentView = content
    for v in [web, splash] {
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
        "JSON.stringify({title: document.title, children: (document.getElementById('root')||{children:[]}).children.length, text: document.body.innerText.slice(0,80), shell: !!(window.chrome && window.chrome.webview)})"
      ) { [self] result, error in
        let text = (result as? String) ?? "error: \(error?.localizedDescription ?? "no result")"
        let ok = text.contains("Codehouse") && !text.contains("\"children\":0") && text.contains("\"shell\":true")
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
