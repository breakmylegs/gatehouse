// Starts the Host (which starts the Approver) from inside Codehouse.app, reads the lines it prints, and stops it. The
// Mac counterpart of packaging/Common.cs. Nothing here writes inside the app: your data and the rules you change live
// in ~/Library/Application Support/Gatehouse, so the app stays as it was signed.
import Foundation

/// A line the Host prints on its standard output, as one JSON object.
enum HostEvent {
  case ready(url: String)
  case attention
  case restart
  case progress(String)
  case awake(Bool)
  case applyUpdate
  case other(String)

  static func parse(_ line: String) -> HostEvent {
    guard let data = line.data(using: .utf8),
      let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let event = j["event"] as? String
    else { return .other(line) }
    switch event {
    case "ready": return (j["url"] as? String).map { .ready(url: $0) } ?? .other(line)
    case "attention": return .attention
    case "restart": return .restart
    case "progress": return .progress(j["text"] as? String ?? "")
    case "awake": return .awake(j["on"] as? Bool ?? false)
    case "apply-update": return .applyUpdate
    default: return .other(line)
    }
  }
}

enum Paths {
  static var resources: URL { Bundle.main.resourceURL ?? URL(fileURLWithPath: ".") }
  static var appDir: URL { resources.appendingPathComponent("app") }
  static var node: URL { resources.appendingPathComponent("runtime/node") }

  /// ~/Library/Application Support/Gatehouse, or GATEHOUSE_DATA_DIR when it is set (the same as the Host's paths.ts).
  static var dataDir: URL {
    if let d = ProcessInfo.processInfo.environment["GATEHOUSE_DATA_DIR"], !d.isEmpty {
      return URL(fileURLWithPath: d)
    }
    return FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Application Support/Gatehouse")
  }

  /// A part's built file, or its source through tsx if the package has no built file.
  static func entry(_ name: String) -> [String] {
    let built = appDir.appendingPathComponent("apps/\(name)/dist/main.mjs")
    if FileManager.default.fileExists(atPath: built.path) { return [built.path] }
    return [
      appDir.appendingPathComponent("node_modules/tsx/dist/cli.mjs").path,
      appDir.appendingPathComponent("apps/\(name)/src/main.ts").path,
    ]
  }
}

/// The PATH your Terminal has. An app started from the Finder gets only /usr/bin:/bin:/usr/sbin:/sbin, so without this
/// Claude would not find Homebrew's or nvm's tools. Read once from your login shell, with a time limit, and never
/// anything else from it: the Claude credentials in the environment are removed whatever the shell says.
/// Apple's developer tools when Xcode's licence is waiting to be accepted. Installing or updating Xcode selects it, and
/// until someone accepts its licence (sudo xcodebuild -license, an administrator's job) /usr/bin/git and the other
/// tools refuse to run: Codehouse's checkpoints and every git command in a session fail. Then, and only then, the Host
/// and its sessions are pointed at the Command Line Tools, which have no licence to accept. A DEVELOPER_DIR you set
/// yourself is left alone.
enum DeveloperTools {
  static let commandLineTools = "/Library/Developer/CommandLineTools"

  /// The folder to use instead, or nil when the tools work as they are.
  static func fallback(git: String = "/usr/bin/git") -> String? {
    if ProcessInfo.processInfo.environment["DEVELOPER_DIR"] != nil { return nil }
    guard FileManager.default.isExecutableFile(atPath: commandLineTools + "/usr/bin/git") else { return nil }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: git)
    p.arguments = ["--version"]
    let err = Pipe()
    p.standardError = err
    p.standardOutput = FileHandle.nullDevice
    p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let done = DispatchSemaphore(value: 0)
    var said = Data()
    DispatchQueue.global().async {
      said = err.fileHandleForReading.readDataToEndOfFile()
      done.signal()
    }
    if done.wait(timeout: .now() + 5) == .timedOut {
      p.terminate()
      return nil
    }
    p.waitUntilExit()
    let text = String(decoding: said, as: UTF8.self).lowercased()
    return p.terminationStatus != 0 && text.contains("license") ? commandLineTools : nil
  }
}

enum ShellPath {
  static let fallback = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

  static func read() -> String {
    let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.hasPrefix("/") ? $0 : nil } ?? "/bin/zsh"
    let marker = "__CODEHOUSE_PATH__"
    let p = Process()
    p.executableURL = URL(fileURLWithPath: shell)
    p.arguments = ["-ilc", "printf '\\n\(marker)%s\(marker)\\n' \"$PATH\""]
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return fallback }
    let done = DispatchSemaphore(value: 0)
    var data = Data()
    DispatchQueue.global().async {
      data = out.fileHandleForReading.readDataToEndOfFile()
      done.signal()
    }
    if done.wait(timeout: .now() + 8) == .timedOut {
      p.terminate()
      return fallback
    }
    let text = String(decoding: data, as: UTF8.self)
    guard let start = text.range(of: marker),
      let end = text.range(of: marker, range: start.upperBound..<text.endIndex)
    else { return fallback }
    let path = String(text[start.upperBound..<end.lowerBound])
    let dirs = path.split(separator: ":").map(String.init).filter { $0.hasPrefix("/") }
    if dirs.isEmpty { return fallback }
    var all = dirs
    for d in fallback.split(separator: ":").map(String.init) where !all.contains(d) { all.append(d) }
    return all.joined(separator: ":")
  }
}

final class HostProcess {
  /// Called on the main queue with each line the Host prints, and once when it exits.
  var onEvent: (HostEvent) -> Void = { _ in }
  var onExit: (Int32) -> Void = { _ in }
  /// Called on the main queue with each line it writes to standard error.
  var onLog: (String) -> Void = { _ in }

  private var process: Process?
  private var input: Pipe?
  private var stopping = false
  private let version: String
  private let path: String

  private let developerDir: String?

  init(version: String, path: String, developerDir: String? = nil) {
    self.version = version
    self.path = path
    self.developerDir = developerDir
  }

  var isRunning: Bool { process?.isRunning == true }

  /// The environment the Host runs with: this app's own, without any Claude credential (invariant 6), and with the
  /// rules you change kept in the data folder instead of inside the app.
  func environment() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    for secret in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] {
      env.removeValue(forKey: secret)
    }
    let data = Paths.dataDir
    let policy = data.appendingPathComponent("policy")
    env["PATH"] = path
    if let developerDir { env["DEVELOPER_DIR"] = developerDir }
    env["GATEHOUSE_EXIT_ON_STDIN_CLOSE"] = "1"
    env["GATEHOUSE_CAN_RESTART"] = "1"
    env["GATEHOUSE_MAC_APP_VERSION"] = version
    // The resource limits per session (packaging/mac/limits), beside this program.
    if let dir = Bundle.main.executableURL?.deletingLastPathComponent() {
      env["GATEHOUSE_MAC_LIMITS"] = dir.appendingPathComponent("codehouse-limits").path
    }
    if env["NODE_COMPILE_CACHE"] == nil { env["NODE_COMPILE_CACHE"] = data.appendingPathComponent("node-cache").path }
    if env["GATEHOUSE_LOCAL_RULES"] == nil {
      env["GATEHOUSE_LOCAL_RULES"] = policy.appendingPathComponent("rules.local.yaml").path
    }
    if env["GATEHOUSE_USER_RULES"] == nil {
      env["GATEHOUSE_USER_RULES"] = policy.appendingPathComponent("rules.user.yaml").path
    }
    if env["GATEHOUSE_OVERLAY_DIR"] == nil {
      env["GATEHOUSE_OVERLAY_DIR"] = policy.appendingPathComponent("projects").path
    }
    return env
  }

  func start() throws {
    let fm = FileManager.default
    guard fm.isExecutableFile(atPath: Paths.node.path) else {
      throw HostError("Node was not found inside Codehouse.app (\(Paths.node.path)). Install Codehouse again.")
    }
    let entry = Paths.entry("host")
    guard fm.fileExists(atPath: entry.last ?? "") else {
      throw HostError("The application files were not found inside Codehouse.app. Install Codehouse again.")
    }
    try fm.createDirectory(
      at: Paths.dataDir.appendingPathComponent("policy/projects"), withIntermediateDirectories: true)

    let p = Process()
    p.executableURL = Paths.node
    p.arguments = entry
    p.currentDirectoryURL = Paths.appDir
    p.environment = environment()
    let stdin = Pipe()
    let stdout = Pipe()
    let stderr = Pipe()
    p.standardInput = stdin
    p.standardOutput = stdout
    p.standardError = stderr
    lines(from: stdout) { [weak self] line in self?.onEvent(HostEvent.parse(line)) }
    lines(from: stderr) { [weak self] line in self?.onLog(line) }
    p.terminationHandler = { [weak self] proc in
      let code = proc.terminationStatus
      DispatchQueue.main.async {
        guard let self, self.process === proc else { return }
        self.process = nil
        self.input = nil
        if !self.stopping { self.onExit(code) }
      }
    }
    stopping = false
    try p.run()
    process = p
    input = stdin
  }

  /// Closes the Host's input, which tells it to stop cleanly, then ends it if it is still running after five seconds.
  func stop(then done: @escaping () -> Void) {
    stopping = true
    guard let p = process, p.isRunning else {
      process = nil
      done()
      return
    }
    try? input?.fileHandleForWriting.close()
    DispatchQueue.global().async {
      let deadline = Date().addingTimeInterval(5)
      while p.isRunning && Date() < deadline { usleep(100_000) }
      if p.isRunning { kill(p.processIdentifier, SIGKILL) }
      p.waitUntilExit()
      DispatchQueue.main.async {
        self.process = nil
        self.input = nil
        done()
      }
    }
  }

  /// Splits what a pipe gives into lines and hands each to `each` on the main queue.
  private func lines(from pipe: Pipe, each: @escaping (String) -> Void) {
    var buffer = Data()
    pipe.fileHandleForReading.readabilityHandler = { h in
      let chunk = h.availableData
      if chunk.isEmpty {
        h.readabilityHandler = nil
        return
      }
      buffer.append(chunk)
      while let nl = buffer.firstIndex(of: 0x0A) {
        let line = String(decoding: buffer[buffer.startIndex..<nl], as: UTF8.self)
        buffer.removeSubrange(buffer.startIndex...nl)
        DispatchQueue.main.async { each(line) }
      }
    }
  }
}

struct HostError: Error, CustomStringConvertible {
  let description: String
  init(_ d: String) { description = d }
}

/// Talks to the Host with the token from the ready address. Best effort: a Host that has gone away is not worth showing.
enum HostClient {
  static func parts(_ url: String) -> (base: String, token: String)? {
    guard let hash = url.range(of: "#token="), let c = URLComponents(string: url), let host = c.host,
      let scheme = c.scheme
    else { return nil }
    let base = "\(scheme)://\(host)" + (c.port.map { ":\($0)" } ?? "")
    return (base, String(url[hash.upperBound...]))
  }

  static func post(_ url: String, route: String, json: String) {
    guard let p = parts(url), let target = URL(string: p.base + route) else { return }
    var r = URLRequest(url: target)
    r.httpMethod = "POST"
    r.setValue("Bearer \(p.token)", forHTTPHeaderField: "Authorization")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = json.data(using: .utf8)
    URLSession.shared.dataTask(with: r).resume()
  }

  /// The check: the Host answers /api/state with its token, and refuses without it.
  static func check(_ url: String, done: @escaping (Bool, String) -> Void) {
    guard let p = parts(url), let target = URL(string: p.base + "/api/state") else {
      return done(false, "the ready address had no token")
    }
    var withToken = URLRequest(url: target, timeoutInterval: 15)
    withToken.setValue("Bearer \(p.token)", forHTTPHeaderField: "Authorization")
    URLSession.shared.dataTask(with: withToken) { data, res, err in
      let body = data.map { String(decoding: $0, as: UTF8.self) } ?? ""
      let ok = (res as? HTTPURLResponse)?.statusCode == 200 && body.contains("\"type\":\"hello\"")
      URLSession.shared.dataTask(with: URLRequest(url: target, timeoutInterval: 15)) { _, res2, _ in
        let refused = ((res2 as? HTTPURLResponse)?.statusCode ?? 0) >= 400
        DispatchQueue.main.async {
          if let err { return done(false, "check error: \(err.localizedDescription)") }
          done(
            ok && refused,
            ok && refused
              ? "the Host answers with its token and refuses without it" : "the Host did not behave as expected")
        }
      }.resume()
    }.resume()
  }
}
