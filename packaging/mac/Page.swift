// What every Codehouse window on a Mac shares (the main window, a session's own window and the quick prompt): the
// interface in the Mac's own WebKit, only Codehouse's own page (NavGuard.swift), the Mac's own file, dialog and save
// windows, and the short messages between the page and the window.
//
// The page talks to its window through `chrome.webview` (apps/web/src/lib/shell.ts, written for WebView2). Here a
// script gives the page the same object over WebKit's message handler. Only the top frame of Codehouse's own page gets
// it, and a message from anywhere else is dropped, so an artifact or a page in a frame can never send one.
import AppKit
import WebKit

/// The page's half of `chrome.webview`, added before any of the page's own scripts run.
let bridgeScript = """
  (() => {
    if (window.chrome && window.chrome.webview) return;
    const listeners = new Set();
    Object.defineProperty(window, "__codehouseShell", {
      value: (data) => { for (const l of [...listeners]) { try { l({ data }) } catch (e) {} } },
    });
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: (m) => window.webkit.messageHandlers.codehouse.postMessage(String(m)),
      addEventListener: (type, l) => { if (type === "message") listeners.add(l) },
      removeEventListener: (type, l) => { if (type === "message") listeners.delete(l) },
    };
  })();
  """

/// WebKit keeps its message handler for as long as the page, so it holds this window weakly.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
  weak var page: PageWindow?
  init(_ page: PageWindow) { self.page = page }
  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    page?.received(message)
  }
}

class PageWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  let window: NSWindow
  let web: WKWebView
  /// The ready address, with its token. Each window's own address is made from it.
  private(set) var readyUrl: String?
  private(set) var origin: String?
  /// Each message the page sends, from Codehouse's own page only.
  var onMessage: (String) -> Void = { _ in }

  // The night sky from docs/brand/palette.json, so a window does not flash white before the page paints.
  static let night = NSColor(srgbRed: 0x0a / 255, green: 0x0b / 255, blue: 0x1e / 255, alpha: 1)

  init(window: NSWindow) {
    self.window = window
    let config = WKWebViewConfiguration()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.preferences.isElementFullscreenEnabled = true
    let script = WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    config.userContentController.addUserScript(script)
    web = WKWebView(frame: .zero, configuration: config)
    web.allowsMagnification = true
    web.allowsBackForwardNavigationGestures = false
    super.init()
    config.userContentController.add(WeakHandler(self), name: "codehouse")
    window.backgroundColor = Self.night
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.delegate = self
    web.navigationDelegate = self
    web.uiDelegate = self
  }

  /// Loads this window's page: the ready address with `query` before its token (`?view=pane&session=...`).
  func load(_ ready: String, query: String = "") {
    readyUrl = ready
    origin = HostClient.parts(ready)?.base
    guard let address = URL(string: Self.address(ready, query: query)) else { return }
    web.load(URLRequest(url: address))
  }

  /// The ready address with a query put in before the `#token=` part, as the Windows window makes it.
  static func address(_ ready: String, query: String) -> String {
    guard !query.isEmpty, let hash = ready.firstIndex(of: "#") else { return ready + query }
    return String(ready[..<hash]) + query + String(ready[hash...])
  }

  /// A message to the page, as WebView2's PostWebMessageAsString gives it.
  func tell(_ message: String) {
    guard let data = try? JSONSerialization.data(withJSONObject: [message]),
      let json = String(data: data, encoding: .utf8)
    else { return }
    web.evaluateJavaScript("window.__codehouseShell && window.__codehouseShell(\(json)[0])", completionHandler: nil)
  }

  fileprivate func received(_ message: WKScriptMessage) {
    let o = message.frameInfo.securityOrigin
    let from = "\(o.protocol)://\(o.host)" + (o.port == 0 ? "" : ":\(o.port)")
    guard message.frameInfo.isMainFrame, NavGuard.sameOrigin(from, origin), let text = message.body as? String else {
      return
    }
    onMessage(text)
  }

  /// When the page has loaded, and when it could not load. For the windows built on this one.
  func pageLoaded() {}

  // MARK: fitting the screen

  /// The usable part of the screen the window is mostly on (without the menu bar and the Dock), or the main screen's.
  var screenArea: NSRect? { (window.screen ?? NSScreen.main)?.visibleFrame }

  /// A first size for a new window: `wanted`, made smaller where the screen is, and centred on it.
  func startSize(_ wanted: NSSize, minimum: NSSize) {
    guard let area = screenArea else { return }
    let w = min(wanted.width, area.width - 40)
    let h = min(wanted.height, area.height - 40)
    window.setFrame(NSRect(x: area.midX - w / 2, y: area.midY - h / 2, width: w, height: h), display: false)
    window.minSize = NSSize(width: min(minimum.width, area.width), height: min(minimum.height, area.height))
  }

  /// Keeps the window on one screen: no larger than its usable area, and inside it. A remembered size from a bigger
  /// screen, or a window dragged across two, would otherwise open hanging off the edges.
  func fitToScreen() {
    guard let area = screenArea else { return }
    let f = window.frame
    var r = f
    r.size.width = min(r.width, area.width)
    r.size.height = min(r.height, area.height)
    r.origin.x = min(max(r.minX, area.minX), area.maxX - r.width)
    r.origin.y = min(max(r.minY, area.minY), area.maxY - r.height)
    if r != f { window.setFrame(r, display: true, animate: false) }
  }

  @objc func windowDidChangeScreen(_ notification: Notification) { fitToScreen() }
  @objc func windowDidEndLiveResize(_ notification: Notification) { fitToScreen() }

  // MARK: zoom

  private static let zoomKey = "Codehouse page zoom"

  /// The interface's zoom (View, Zoom In and Zoom Out), kept for next time and shared by the session windows.
  static var savedZoom: CGFloat {
    get {
      let z = UserDefaults.standard.double(forKey: zoomKey)
      return z >= 0.5 && z <= 3 ? CGFloat(z) : 1
    }
    set { UserDefaults.standard.set(Double(newValue), forKey: zoomKey) }
  }
  func pageFailed(_ why: String) {}

  // MARK: navigation guard

  private func refused(_ target: URL?, where place: String) -> Bool {
    let uri = target?.absoluteString
    let action = NavGuard.decide(uri, origin: origin, where: place)
    if action == .allow { return false }
    if action == .external, let target { NSWorkspace.shared.open(target) }
    if let readyUrl {
      HostClient.post(
        readyUrl, route: "/api/shell/navigation", json: NavGuard.report(where: place, uri: uri, action: action))
    }
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
    pageLoaded()
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
    pageFailed(e.localizedDescription)
  }

  /// WebKit's page process ended (out of memory, a crash): load the page again.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    web.reload()
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

  /// The microphone and camera are never given to the page. Voice typing is the Mac's own dictation, which types
  /// into the page; Codehouse itself hears nothing.
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
