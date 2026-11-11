// Codehouse on a Mac: the app that holds the window, the menu bar icon and the Host. The Mac counterpart of
// packaging/CodehouseApp.cs. Closing the window keeps Codehouse running, so a request that needs you still reaches you
// (the Dock icon bounces and a notification says so, never what the request is). Quit stops the Host and the Approver.
import AppKit
import IOKit.pwr_mgt
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
  private let check: Bool
  private let version: String
  private var main: MainWindow!
  private var host: HostProcess?
  private var status: NSStatusItem?
  private var url: String?
  private var quitting = false
  private var awake: IOPMAssertionID = 0
  private var log: [String] = []
  private var startedAt = Date()
  private var stage = "Starting Codehouse"
  private var stageSince = Date()
  private var clock: Timer?
  /// The exit code for --check.
  private(set) var exitCode: Int32 = 0

  init(check: Bool) {
    self.check = check
    version = Bundle.main.object(forInfoDictionaryKey: "CodehouseVersion") as? String ?? "0.0.0-mac"
  }

  // MARK: starting

  func applicationDidFinishLaunching(_ notification: Notification) {
    main = MainWindow(check: check)
    main.onLoaded = { [weak self] ok, detail in self?.pageLoaded(ok, detail) }
    if check {
      say("Codehouse \(version) check")
      DispatchQueue.main.asyncAfter(deadline: .now() + 240) { [weak self] in
        self?.finish(1, "Check failed: it did not finish in 4 minutes.")
      }
    } else {
      buildMenu()
      buildStatusItem()
      main.window.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      if Bundle.main.bundleIdentifier != nil {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
      }
      clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.showStage() }
    }
    startHost()
  }

  private func startHost() {
    startedAt = Date()
    log.removeAll()
    step("Reading your PATH")
    DispatchQueue.global().async { [self] in
      let path = ShellPath.read()
      DispatchQueue.main.async { [self] in
        let h = HostProcess(version: version, path: path)
        h.onEvent = { [weak self] e in self?.hostSaid(e) }
        h.onLog = { [weak self] line in self?.remember(line) }
        h.onExit = { [weak self] code in self?.hostExited(code) }
        host = h
        step("Loading Codehouse's code")
        do { try h.start() } catch { fail("Could not start the Host: \(error)") }
      }
    }
  }

  private func hostSaid(_ e: HostEvent) {
    switch e {
    case .ready(let u):
      url = u
      step("Opening the window")
      say("Ready: \(HostClient.parts(u)?.base ?? "")")
      if check {
        HostClient.check(u) { [self] ok, message in
          if !ok { return finish(1, "Check failed: \(message).") }
          say("Host check passed: \(message).")
          main.load(u)
        }
      } else {
        main.load(u)
      }
    case .attention: attention()
    case .restart: restart("Starting again")
    case .progress(let text): step(text)
    case .awake(let on): keepAwake(on)
    case .applyUpdate:
      remember("[update] an update was offered, but Codehouse updates on a Mac by installing a newer Codehouse.app")
    case .other(let line): remember(line)
    }
  }

  private func pageLoaded(_ ok: Bool, _ detail: String) {
    if check {
      say("Window page: \(detail)")
      return finish(
        ok ? 0 : 1,
        ok
          ? "Check passed: the window loaded the interface from the packaged Host."
          : "Check failed: the window did not show the interface.")
    }
    clock?.invalidate()
    clock = nil
    if ok { sayIfRestarted() }
  }

  // MARK: the start-up picture

  private func step(_ text: String) {
    guard !text.isEmpty, text != stage else { return }
    stage = text
    stageSince = Date()
    showStage()
  }

  private func showStage() {
    let total = Int(Date().timeIntervalSince(startedAt))
    let now = Int(Date().timeIntervalSince(stageSince))
    var text = "\(stage)  (\(now) s)"
    if total > 20 { text += "\nThe first start after installing is the slowest." }
    main?.say(text)
  }

  private func remember(_ line: String) {
    log.append(line)
    if log.count > 200 { log.removeFirst(log.count - 120) }
    if check { say(line) }
  }

  private var tail: String { log.suffix(12).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) }

  private func say(_ text: String) {
    guard check else { return }
    print("[gatehouse] \(text)")
    fflush(stdout)
  }

  private func fail(_ message: String) {
    let t = tail
    if check { return finish(1, message + (t.isEmpty ? "" : "\n" + t)) }
    clock?.invalidate()
    clock = nil
    main.fail(message + (t.isEmpty ? "" : "\n\nWhat it said:\n" + t) + "\n\nQuit Codehouse (Command-Q) and open it again.")
    showWindow()
  }

  private func finish(_ code: Int32, _ message: String) {
    say(message)
    exitCode = code
    quitting = true
    keepAwake(false)
    let done: () -> Void = { exit(code) }
    if let host { host.stop(then: done) } else { done() }
  }

  // MARK: the Host stopping and starting again

  private func hostExited(_ code: Int32) {
    keepAwake(false)
    if quitting { return }
    if check { return finish(1, "Check failed: the Host stopped.\n" + tail) }
    // Starting again would meet the same Codehouse on the same port.
    if log.contains(where: { $0.contains("EADDRINUSE") }) {
      return fail(
        "Another Codehouse is already running on this Mac, perhaps one started with npm start in Terminal. Stop that one, then open Codehouse again."
      )
    }
    let how = "code \(code)"
    appendLine("host.log", "\(ISO8601DateFormatter().string(from: Date())) the Host stopped unexpectedly with \(how)")
    // Started again by itself, at most three times in ten minutes: open sessions come back as after an update.
    if takeRestart() {
      try? how.write(to: restartedMarker, atomically: true, encoding: .utf8)
      return restart("Codehouse stopped unexpectedly, so it is starting again")
    }
    fail(
      "Codehouse stopped unexpectedly, with \(how). It started again by itself three times in ten minutes, so it is waiting for you now."
    )
  }

  private func restart(_ text: String) {
    clock?.invalidate()
    main.showStarting(text)
    stage = text
    stageSince = Date()
    clock = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.showStage() }
    let again = { [weak self] in
      self?.url = nil
      self?.startHost()
    }
    if let host { host.stop(then: again) } else { again() }
  }

  private var restartedMarker: URL { Paths.dataDir.appendingPathComponent("restarted-after-stop.txt") }

  private func takeRestart() -> Bool {
    let file = Paths.dataDir.appendingPathComponent("host-restarts.txt")
    let f = ISO8601DateFormatter()
    let now = Date()
    let recent = ((try? String(contentsOf: file, encoding: .utf8)) ?? "")
      .split(separator: "\n").map(String.init)
      .filter { f.date(from: $0).map { now.timeIntervalSince($0) < 600 } ?? false }
    if recent.count >= 3 { return false }
    try? (recent + [f.string(from: now)]).joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
    return true
  }

  private func sayIfRestarted() {
    guard let how = try? String(contentsOf: restartedMarker, encoding: .utf8) else { return }
    try? FileManager.default.removeItem(at: restartedMarker)
    notify(
      id: "restarted", title: "Codehouse started again",
      body: "It stopped unexpectedly (\(how.trimmingCharacters(in: .whitespacesAndNewlines))) and started again by itself. Open sessions came back.")
  }

  private func appendLine(_ name: String, _ line: String) {
    let file = Paths.dataDir.appendingPathComponent(name)
    try? FileManager.default.createDirectory(at: Paths.dataDir, withIntermediateDirectories: true)
    if let h = try? FileHandle(forWritingTo: file) {
      h.seekToEndOfFile()
      h.write((line + "\n").data(using: .utf8)!)
      try? h.close()
    } else {
      try? (line + "\n").write(to: file, atomically: true, encoding: .utf8)
    }
  }

  // MARK: something needs you

  /// The Dock icon bounces until you come to Codehouse, and a notification says that something needs your decision.
  /// It never says what: a notification can show on a locked screen.
  private func attention() {
    if NSApp.isActive && main.window.isKeyWindow { return }
    NSApp.requestUserAttention(.criticalRequest)
    NSApp.dockTile.badgeLabel = "!"
    setStatusImage(attention: true)
    notify(id: "attention", title: "Codehouse", body: "Something needs your decision")
  }

  private func notify(id: String, title: String, body: String) {
    guard Bundle.main.bundleIdentifier != nil else { return }
    let c = UNMutableNotificationContent()
    c.title = title
    c.body = body
    c.sound = .default
    // The same id each time, so a new one replaces the last rather than piling up.
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    DispatchQueue.main.async { self.showWindow() }
    completionHandler()
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound])
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    NSApp.dockTile.badgeLabel = nil
    setStatusImage(attention: false)
    if Bundle.main.bundleIdentifier != nil {
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["attention"])
    }
  }

  // MARK: keep the computer awake while a session works

  /// No idle sleep while a session works (owner, 4 Nov). The display may still turn off, and closing the lid still
  /// sleeps, as on Windows.
  private func keepAwake(_ on: Bool) {
    if on && awake == 0 {
      IOPMAssertionCreateWithName(
        kIOPMAssertionTypePreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
        "Codehouse: a session is working" as CFString, &awake)
    } else if !on && awake != 0 {
      IOPMAssertionRelease(awake)
      awake = 0
    }
  }

  // MARK: the window, the menus and the menu bar icon

  @objc func showWindow() {
    if main.window.isMiniaturized { main.window.deminiaturize(nil) }
    main.window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showWindow()
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard !quitting, let host, host.isRunning else { return .terminateNow }
    quitting = true
    keepAwake(false)
    host.stop { NSApp.reply(toApplicationShouldTerminate: true) }
    return .terminateLater
  }

  func applicationWillTerminate(_ notification: Notification) {
    keepAwake(false)
  }

  private func buildStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    item.button?.toolTip = "Codehouse"
    let menu = NSMenu()
    menu.addItem(withTitle: "Open Codehouse", action: #selector(showWindow), keyEquivalent: "").target = self
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Codehouse", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    item.menu = menu
    status = item
    setStatusImage(attention: false)
  }

  private func setStatusImage(attention: Bool) {
    guard let button = status?.button else { return }
    let name = attention ? "attention" : "normal"
    let image = NSImage(size: NSSize(width: 16, height: 16))
    for px in [16, 32] {
      if let file = Bundle.main.url(forResource: "tray-\(name)-\(px)", withExtension: "png"),
        let rep = NSImageRep(contentsOf: file)
      {
        rep.size = NSSize(width: 16, height: 16)
        image.addRepresentation(rep)
      }
    }
    button.image = image.representations.isEmpty ? nil : image
    if button.image == nil { button.title = "CH" }
  }

  @objc private func zoomIn() { main.zoom(by: 0.1) }
  @objc private func zoomOut() { main.zoom(by: -0.1) }
  @objc private func actualSize() { main.zoom(by: nil) }

  @objc private func showData() {
    NSWorkspace.shared.open(Paths.dataDir)
  }

  private func buildMenu() {
    let bar = NSMenu()

    let app = NSMenu(title: "Codehouse")
    app.addItem(withTitle: "About Codehouse", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    app.addItem(.separator())
    let services = NSMenu(title: "Services")
    app.addItem(withTitle: "Services", action: nil, keyEquivalent: "").submenu = services
    NSApp.servicesMenu = services
    app.addItem(.separator())
    app.addItem(withTitle: "Hide Codehouse", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    others.keyEquivalentModifierMask = [.command, .option]
    app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    app.addItem(.separator())
    app.addItem(withTitle: "Quit Codehouse", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    bar.addItem(withTitle: "Codehouse", action: nil, keyEquivalent: "").submenu = app

    // Without these, Command-C, V, X, A and Z do nothing in the page.
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    let plain = edit.addItem(withTitle: "Paste and Match Style", action: #selector(NSTextView.pasteAsPlainText(_:)), keyEquivalent: "V")
    plain.keyEquivalentModifierMask = [.command, .option, .shift]
    edit.addItem(withTitle: "Delete", action: #selector(NSText.delete(_:)), keyEquivalent: "")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    bar.addItem(withTitle: "Edit", action: nil, keyEquivalent: "").submenu = edit

    // Command-comma, K and the number keys are left to the page, which has its own shortcuts for them.
    let view = NSMenu(title: "View")
    view.addItem(withTitle: "Actual Size", action: #selector(actualSize), keyEquivalent: "0").target = self
    view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+").target = self
    view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-").target = self
    view.addItem(.separator())
    let full = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    full.keyEquivalentModifierMask = [.command, .control]
    bar.addItem(withTitle: "View", action: nil, keyEquivalent: "").submenu = view

    let window = NSMenu(title: "Window")
    window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    window.addItem(.separator())
    window.addItem(withTitle: "Codehouse", action: #selector(showWindow), keyEquivalent: "").target = self
    window.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
    bar.addItem(withTitle: "Window", action: nil, keyEquivalent: "").submenu = window
    NSApp.windowsMenu = window

    let help = NSMenu(title: "Help")
    help.addItem(withTitle: "Show Codehouse's Data Folder", action: #selector(showData), keyEquivalent: "").target = self
    bar.addItem(withTitle: "Help", action: nil, keyEquivalent: "").submenu = help
    NSApp.helpMenu = help

    NSApp.mainMenu = bar
  }
}
