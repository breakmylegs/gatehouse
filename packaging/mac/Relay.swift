// The phone Relay, run by Codehouse.app itself: the Mac counterpart of the Windows window's --relay. Once it is set
// up (an https address given once, remembered in its data folder), it starts with Codehouse and stops when you quit,
// so pairing and using the phone need no Terminal. It still needs that https address in front of it (Tailscale or a
// Cloudflare tunnel; docs/relay-local.md). It listens on 127.0.0.1 only and only ever holds ciphertext.
import Foundation

final class RelayProcess {
  static let port: UInt16 = 8087

  /// Where the Relay keeps its data: as apps/relay/src/config-mac.ts finds it, passed to it explicitly.
  static var dataDir: URL {
    if let d = ProcessInfo.processInfo.environment["GATEHOUSE_DATA_DIR"], !d.isEmpty {
      return URL(fileURLWithPath: d).appendingPathComponent("relay")
    }
    let earlier = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".gatehouse-relay")
    if FileManager.default.fileExists(atPath: earlier.path) { return earlier }
    return Paths.dataDir.appendingPathComponent("relay")
  }

  /// The https address it was set up with, or nil before it has been.
  static var savedAddress: String? {
    guard let data = try? Data(contentsOf: dataDir.appendingPathComponent("relay.json")),
      let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return nil }
    return j["publicUrl"] as? String
  }

  /// The one-time enrolment token Devices asks for. The Relay writes a new one after each use.
  static var token: String? {
    (try? String(contentsOf: dataDir.appendingPathComponent("enrol-token.txt"), encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// Something already answers on the Relay's port: an npm run relay you started, or one left from before.
  static func portInUse() -> Bool {
    let s = socket(AF_INET, SOCK_STREAM, 0)
    guard s >= 0 else { return false }
    defer { close(s) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    return withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
      }
    }
  }

  private var process: Process?
  private var lastLines: [String] = []
  /// Called on the main queue when it stops by itself, with what it last said.
  var onStop: (_ said: String) -> Void = { _ in }

  var isRunning: Bool { process?.isRunning == true }

  /// Starts it; with an address, sets it up first (the Relay refuses a different address once set up).
  func start(address: String? = nil) throws {
    guard !isRunning else { return }
    let entry = Paths.entry("relay")
    guard FileManager.default.fileExists(atPath: entry.last ?? "") else {
      throw HostError("The Relay is not inside Codehouse.app. Install Codehouse again.")
    }
    var env = ProcessInfo.processInfo.environment
    for secret in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] { env.removeValue(forKey: secret) }
    env["RELAY_DATA_DIR"] = Self.dataDir.path
    if env["NODE_COMPILE_CACHE"] == nil {
      env["NODE_COMPILE_CACHE"] = Paths.dataDir.appendingPathComponent("node-cache").path
    }
    try FileManager.default.createDirectory(at: Self.dataDir, withIntermediateDirectories: true)
    let p = Process()
    let relayArgs = [Paths.node.path] + entry + (address.map { ["--public-url", $0] } ?? [])
    // Through codehouse-limits (no limits): when Codehouse ends, however it ends, the helper ends the Relay with it.
    if let dir = Bundle.main.executableURL?.deletingLastPathComponent(),
      FileManager.default.isExecutableFile(atPath: dir.appendingPathComponent("codehouse-limits").path)
    {
      p.executableURL = dir.appendingPathComponent("codehouse-limits")
      p.arguments = ["--name", "codehouse-relay", "--cpu", "0", "--memory-mb", "0", "--priority", "normal", "--"] + relayArgs
    } else {
      p.executableURL = Paths.node
      p.arguments = Array(relayArgs.dropFirst())
    }
    p.currentDirectoryURL = Paths.appDir
    p.environment = env
    p.standardInput = FileHandle.nullDevice
    let out = Pipe()
    p.standardOutput = out
    p.standardError = out
    lastLines = []
    out.fileHandleForReading.readabilityHandler = { [weak self] h in
      let chunk = h.availableData
      if chunk.isEmpty {
        h.readabilityHandler = nil
        return
      }
      let text = String(decoding: chunk, as: UTF8.self)
      DispatchQueue.main.async {
        self?.lastLines.append(contentsOf: text.split(separator: "\n").map(String.init))
        if let n = self?.lastLines.count, n > 20 { self?.lastLines.removeFirst(n - 20) }
      }
    }
    p.terminationHandler = { [weak self] proc in
      DispatchQueue.main.async {
        guard let self, self.process === proc else { return }
        self.process = nil
        self.onStop(self.lastLines.suffix(4).joined(separator: "\n"))
      }
    }
    try p.run()
    process = p
  }

  /// Stops it as Ctrl+C would (it closes cleanly on SIGTERM; the helper passes the stop on).
  func stop() {
    guard let p = process else { return }
    process = nil
    if p.isRunning { p.terminate() }
  }
}
