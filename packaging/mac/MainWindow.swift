// The Codehouse window on a Mac: the interface in the Mac's own WebKit, with the start-up picture while the Host starts.
// Only Codehouse's own page is shown (NavGuard.swift); a web link opens in your default browser.
import AppKit
import WebKit

final class MainWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  let window: NSWindow
  private let web: WKWebView
  private let splash = NSView()
  private let splashText = NSTextField(wrappingLabelWithString: "")
  private let spinner = NSProgressIndicator()
  private var url: String?
  private var origin: String?
  private var loaded = false
  private let check: Bool
  /// Called once the page has loaded (and, in check mode, with what it showed).
  var onLoaded: (_ ok: Bool, _ detail: String) -> Void = { _, _ in }

  // The night sky from docs/brand/palette.json, so the window does not flash white before the page paints.
  static let night = NSColor(srgbRed: 0x0a / 255, green: 0x0b / 255, blue: 0x1e / 255, alpha: 1)

  init(check: Bool) {
    self.check = check
    let config = WKWebViewConfiguration()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.preferences.isElementFullscreenEnabled = true
    web = WKWebView(frame: .zero, configuration: config)
    web.allowsMagnification = true
    web.allowsBackForwardNavigationGestures = false
    web.isHidden = true
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    super.init()
    window.title = "Codehouse"
    window.minSize = NSSize(width: 900, height: 600)
    window.backgroundColor = Self.night
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.delegate = self
    window.center()
    if !check { window.setFrameAutosaveName("Codehouse main window") }
    web.navigationDelegate = self
    web.uiDelegate = self

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

  func load(_ readyUrl: String) {
    url = readyUrl
    origin = HostClient.parts(readyUrl)?.base
    loaded = false
    say("Opening the window")
    if let u = URL(string: readyUrl) { web.load(URLRequest(url: u)) }
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

  // MARK: navigation guard

  private func refused(_ target: URL?, where place: String) -> Bool {
    let uri = target?.absoluteString
    let action = NavGuard.decide(uri, origin: origin, where: place)
    if action == .allow { return false }
    if action == .external, let target { NSWorkspace.shared.open(target) }
    if let url { HostClient.post(url, route: "/api/shell/navigation", json: NavGuard.report(where: place, uri: uri, action: action)) }
    return true
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let target = action.request.url
    // A file the page saves (a blob or data address, or one of the Host's own) is a download, never a page.
    if action.shouldPerformDownload {
      let s = target?.scheme?.lowercased()
      let own = NavGuard.sameOrigin(target?.absoluteString ?? "", origin)
      return decisionHandler(s == "blob" || s == "data" || own ? .download : .cancel)
    }
    let place = action.targetFrame?.isMainFrame == false ? "frame" : "window"
    decisionHandler(refused(target, where: place) ? .cancel : .allow)
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  /// A link that would open a new window: never a window of ours. A web page goes to your browser.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    _ = refused(action.request.url, where: "new-window")
    return nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard !loaded else { return }
    loaded = true
    if check { return checkPage() }
    splash.isHidden = true
    web.isHidden = false
    window.makeFirstResponder(web)
    onLoaded(true, "")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  private func failed(_ error: Error) {
    let e = error as NSError
    // Cancelled by the guard or by a newer navigation: not a failure.
    if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
    if loaded { return }
    fail("The window could not load the Codehouse interface (\(e.localizedDescription)).")
    onLoaded(false, e.localizedDescription)
  }

  /// WebKit's page process ended (out of memory, a crash): load the interface again.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    if let url { load(url) }
  }

  private func checkPage() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [self] in
      web.evaluateJavaScript(
        "JSON.stringify({title: document.title, children: (document.getElementById('root')||{children:[]}).children.length, text: document.body.innerText.slice(0,80)})"
      ) { [self] result, error in
        let text = (result as? String) ?? "error: \(error?.localizedDescription ?? "no result")"
        let ok = text.contains("Codehouse") && !text.contains("\"children\":0")
        onLoaded(ok, text)
      }
    }
  }

  // MARK: what the page asks of the window

  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
  ) {
    let a = NSAlert()
    a.messageText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
    field.stringValue = defaultText ?? ""
    a.accessoryView = field
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.window.initialFirstResponder = field
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil) }
  }

  /// A file field in the page (attaching files): the Mac's own open window.
  func webView(
    _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
  }

  /// The microphone and camera: only the voice button could want them, and it is a Windows feature for now.
  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }

  // MARK: downloads

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    panel.beginSheetModal(for: window) { r in
      guard r == .OK, let dest = panel.url else { return completionHandler(nil) }
      // The save window has already asked about replacing a file of that name.
      try? FileManager.default.removeItem(at: dest)
      completionHandler(dest)
    }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let a = NSAlert()
    a.messageText = "The file was not saved"
    a.informativeText = error.localizedDescription
    a.beginSheetModal(for: window)
  }
}
