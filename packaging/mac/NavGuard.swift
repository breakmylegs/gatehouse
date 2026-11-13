// CH-01 on a Mac: the Codehouse window shows only Codehouse's own page. The same rules as packaging/NavGuard.cs, so a
// navigation away is cancelled, a link the page opens goes to your default browser, and the Host audits each one. No
// claude.ai or Anthropic sign-in page is ever loaded inside the window, not even in a frame.
//
// Foundation only, so apps/host/test/navguard-mac.test.ts can build it with test/main.swift and run it.
import Foundation

enum NavAction: String {
  case allow, external, refuse
}

enum NavGuard {
  /// An absolute address with a scheme, and a port a real address can have. URLComponents takes :471234, which
  /// Windows' parser (and so packaging/NavGuard.cs) refuses.
  private static func parse(_ text: String) -> URLComponents? {
    guard let c = URLComponents(string: text), let scheme = c.scheme, !scheme.isEmpty else { return nil }
    if let port = c.port, !(0...65535).contains(port) { return nil }
    return c
  }

  private static func hasUser(_ c: URLComponents) -> Bool {
    (c.user?.isEmpty == false) || (c.password?.isEmpty == false) || c.percentEncodedUser != nil
  }

  private static func defaultPort(_ scheme: String?) -> Int? {
    switch scheme?.lowercased() {
    case "http": return 80
    case "https": return 443
    default: return nil
    }
  }

  private static func effectivePort(_ c: URLComponents) -> Int? {
    c.port ?? defaultPort(c.scheme)
  }

  /// The same scheme, host and port, with no user name in the address. A prefix test let
  /// http://127.0.0.1:1234@elsewhere.example through, and :12345 after :1234.
  static func sameOrigin(_ uri: String, _ origin: String?) -> Bool {
    guard let origin, let u = parse(uri), let o = parse(origin) else { return false }
    return !hasUser(u)
      && u.scheme?.lowercased() == o.scheme?.lowercased()
      && (u.host ?? "").lowercased() == (o.host ?? "").lowercased()
      && effectivePort(u) == effectivePort(o)
  }

  private static func inline(_ uri: String) -> Bool {
    let l = uri.lowercased()
    return l.hasPrefix("about:") || l.hasPrefix("data:")
  }

  /// A page on this computer, shown in the Files pane's browser frame (a dev server you started).
  private static func loopback(_ uri: String) -> Bool {
    guard let u = parse(uri), !hasUser(u), let s = u.scheme?.lowercased(), s == "http" || s == "https" else {
      return false
    }
    let h = (u.host ?? "").lowercased()
    return h == "127.0.0.1" || h == "::1" || h == "[::1]" || h == "localhost"
  }

  private static func web(_ uri: String) -> Bool {
    guard let u = parse(uri), let s = u.scheme?.lowercased(), s == "http" || s == "https" else { return false }
    return u.host?.isEmpty == false
  }

  /// What to do with a navigation. `where` is "window" (the page itself), "frame" (a frame inside it) or
  /// "new-window" (a link that opens a window). Allow means nothing is cancelled or reported.
  static func decide(_ uri: String?, origin: String?, where place: String) -> NavAction {
    guard let uri, !uri.isEmpty else { return .refuse }
    if sameOrigin(uri, origin) { return .allow }
    if place == "frame" {
      // A frame's address is chosen by the page, so it never opens anything outside: it is simply stopped.
      if inline(uri) || uri.lowercased().hasPrefix("blob:") || loopback(uri) { return .allow }
      return .refuse
    }
    if place == "window" && inline(uri) { return .allow }
    return web(uri) ? .external : .refuse
  }

  /// What the audit records: the scheme and host only, never the path or query, which can carry names and tokens.
  /// Only plain address characters survive, so the result is safe inside JSON.
  static func describe(_ uri: String?) -> String {
    guard let uri, !uri.isEmpty else { return "" }
    var text = ""
    if let u = parse(uri), let host = u.host, !host.isEmpty, let scheme = u.scheme {
      let h = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
      let port = u.port.flatMap { $0 == defaultPort(scheme) ? nil : $0 }
      text = "\(scheme)://\(h)" + (port.map { ":\($0)" } ?? "")
    } else if let colon = uri.firstIndex(of: ":") {
      let n = uri.distance(from: uri.startIndex, to: colon)
      if n > 0 && n <= 20 { text = String(uri[...colon]) }
    }
    let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789.-:/[]")
    let kept = String(text.lowercased().filter { allowed.contains($0) })
    return String(kept.prefix(120))
  }

  /// The JSON the window sends to the Host's /api/shell/navigation.
  static func report(where place: String, uri: String?, action: NavAction) -> String {
    "{\"where\":\"\(place)\",\"target\":\"\(describe(uri))\",\"opened\":\(action == .external ? "true" : "false")}"
  }
}
