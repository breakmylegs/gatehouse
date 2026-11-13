// CH-08 on a Mac: a picture of part of the screen, or of the window you were in, taken from the quick prompt and
// attached to the chat. The Mac's own screencapture takes it (the first time, macOS asks you to let Codehouse record
// the screen). Pictures are not redacted, which the quick prompt says; the Host audits each one when it is attached.
// Nothing is kept here: the file is read and removed, and the picture goes back to the page as PNG bytes.
import AppKit

enum ScreenCapture {
  /// The most a capture may be, as the attach route allows (as packaging/Capture.cs).
  static let maxBytes = 20 * 1024 * 1024

  /// The frontmost normal window of an app, from the window server's list, front to back.
  static func frontWindow(of pid: pid_t) -> CGWindowID? {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]]
    else { return nil }
    for w in list {
      guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid, (w[kCGWindowLayer as String] as? Int) == 0,
        let id = w[kCGWindowNumber as String] as? CGWindowID
      else { continue }
      return id
    }
    return nil
  }

  /// Takes the picture off the main thread and calls back on it with PNG bytes, or nil if you cancelled (Esc) or it
  /// could not be taken. `window`: the window with this id; otherwise the part of the screen you choose.
  static func take(window: CGWindowID?, done: @escaping (Data?) -> Void) {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("codehouse-capture-\(UUID().uuidString).png")
    // -x: no sound; -o: no shadow; -i: you choose the part (Space switches to choosing a window); -l: this window.
    let args = window.map { ["-x", "-o", "-l", String($0), file.path] } ?? ["-x", "-i", file.path]
    DispatchQueue.global().async {
      let p = Process()
      p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
      p.arguments = args
      var png: Data?
      if (try? p.run()) != nil {
        p.waitUntilExit()
        png = try? Data(contentsOf: file)
      }
      try? FileManager.default.removeItem(at: file)
      if let d = png, d.isEmpty || d.count > maxBytes { png = nil }
      DispatchQueue.main.async { done(png) }
    }
  }
}
