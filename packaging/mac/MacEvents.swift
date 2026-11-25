// What the Mac tells Codehouse and what Codehouse may say back, kept apart from AppKit so it is tested as compiled
// (apps/host/test/mac-events-mac.test.ts, through test/events/main.swift). Owner, 25 Nov:
//   - a request's notification has Deny, and Allow once for a permission below High, from the Host's own say
//     (apps/host/src/notify-mac.ts); it never says what the request is, only how risky
//   - a folder from the Finder (its Services menu, a drop on the Dock icon, open -a Codehouse <folder>) opens the
//     start-session form with it filled in, as a folder opened from a terminal does on Windows (T-002)
//   - the screen locking, sleep, wake and power changes go to the Host as one line each (apps/host/src/presence-mac.ts)
import Foundation

/// What the Host's "attention" line says of a request: never the command, a path or the project.
struct RequestNotice: Equatable {
  let id: String
  let kind: String
  let band: String
  let allow: Bool

  static let allowCategory = "codehouse-request-allow"
  static let denyCategory = "codehouse-request-deny"
  static let denyAction = "deny"
  static let allowAction = "allow"

  /// From the line's fields, or nil when the id is not one the Host makes (letters, digits and dashes).
  static func from(_ j: [String: Any]) -> RequestNotice? {
    guard let id = j["id"] as? String, validId(id), let kind = j["kind"] as? String else { return nil }
    let band = j["band"] as? String ?? ""
    return RequestNotice(
      id: id, kind: kind, band: ["low", "moderate", "high", "severe"].contains(band) ? band : "",
      allow: j["allow"] as? Bool == true && kind == "permission")
  }

  static func validId(_ id: String) -> Bool {
    !id.isEmpty && id.count <= 64 && id.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "-" }
  }

  /// The notification's own id, so a decided request's is taken away.
  var identifier: String { "request-\(id)" }

  /// Deny and Allow once, Deny alone, or no buttons (a question or a plan needs reading in the window).
  var category: String? {
    guard kind == "permission" else { return nil }
    return allow ? Self.allowCategory : Self.denyCategory
  }

  var body: String {
    switch kind {
    case "question": return "Claude has a question for you"
    case "plan": return "A plan is waiting for your approval"
    default: return band.isEmpty ? "Something needs your decision" : "A \(band) risk request needs your decision"
    }
  }

  /// What the page is told for a button: notify-deny:<id> or notify-allow:<id>; nil for anything else.
  func message(for action: String) -> String? {
    if action == Self.denyAction && category != nil { return "notify-deny:\(id)" }
    if action == Self.allowAction && category == Self.allowCategory { return "notify-allow:\(id)" }
    return nil
  }
}

enum FinderFolder {
  /// The first real folder among `paths`, as the page takes one: an absolute path of at most 1000 characters with no
  /// line break. Nil when there is none: a file cannot be a project.
  static func pick(_ paths: [String], isFolder: (String) -> Bool) -> String? {
    paths.first { p in
      p.hasPrefix("/") && p.count <= 1000 && !p.contains(where: { $0 == "\n" || $0 == "\r" }) && isFolder(p)
    }
  }

  static func isFolder(_ path: String) -> Bool {
    var dir: ObjCBool = false
    return FileManager.default.fileExists(atPath: path, isDirectory: &dir) && dir.boolValue
  }
}

/// A line for the Host's input. Only these words: the Host ignores anything else.
enum MacSignal: String {
  case locked, unlocked, sleep, wake, power

  var line: String { "{\"event\":\"\(rawValue)\"}\n" }
}
