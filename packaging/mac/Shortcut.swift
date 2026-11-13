// The quick prompt's shortcut on a Mac (W1-15): the text you type in Settings, such as Control+Option+Space, read into
// the key code and modifiers the Mac's hot key registration wants, and three free alternatives when another app has
// it. The same rules as packaging/Hotkey.cs, in a Mac's words: Ctrl and Alt are read as Control and Option, and Win as
// Command, so a shortcut chosen on Windows still works. Written back the Mac's way, in Apple's order.
//
// Foundation only, so apps/host/test/shortcut-mac.test.ts can build it with test/main.swift and run it.
import Foundation

struct Shortcut: Equatable {
  // Carbon's modifier bits (cmdKey, shiftKey, optionKey, controlKey), written out so this file needs only Foundation.
  static let command: UInt32 = 0x100
  static let shift: UInt32 = 0x200
  static let option: UInt32 = 0x800
  static let control: UInt32 = 0x1000
  static let defaultText = "Control+Option+Space"

  let mods: UInt32
  let key: UInt32

  /// Carbon's virtual key codes (kVK_...) for the keys a shortcut may use.
  static let keys: [(String, UInt32)] = {
    var k: [(String, UInt32)] = [
      ("A", 0x00), ("S", 0x01), ("D", 0x02), ("F", 0x03), ("H", 0x04), ("G", 0x05), ("Z", 0x06), ("X", 0x07),
      ("C", 0x08), ("V", 0x09), ("B", 0x0B), ("Q", 0x0C), ("W", 0x0D), ("E", 0x0E), ("R", 0x0F), ("Y", 0x10),
      ("T", 0x11), ("1", 0x12), ("2", 0x13), ("3", 0x14), ("4", 0x15), ("6", 0x16), ("5", 0x17), ("9", 0x19),
      ("7", 0x1A), ("8", 0x1C), ("0", 0x1D), ("O", 0x1F), ("U", 0x20), ("I", 0x22), ("P", 0x23), ("L", 0x25),
      ("J", 0x26), ("K", 0x28), ("N", 0x2D), ("M", 0x2E),
      ("Space", 0x31), ("Home", 0x73), ("PageUp", 0x74), ("End", 0x77), ("PageDown", 0x79),
    ]
    let f: [UInt32] = [
      0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F, 0x69, 0x6B, 0x71, 0x6A, 0x40, 0x4F,
      0x50, 0x5A,
    ]
    for (i, code) in f.enumerated() { k.append(("F\(i + 1)", code)) }
    return k
  }()

  private static func modifier(_ word: String) -> UInt32? {
    switch word.lowercased() {
    case "ctrl", "control", "⌃": return control
    case "alt", "option", "opt", "⌥": return option
    case "shift", "⇧": return shift
    case "cmd", "command", "win", "windows", "⌘": return command
    default: return nil
    }
  }

  private static func keyCode(_ word: String) -> UInt32? {
    if word.count == 1 { return keys.first { $0.0 == word.uppercased() }?.1 }
    return keys.first { $0.0.lowercased() == word.lowercased() }?.1
  }

  /// Reads a shortcut. It needs Control, Option or Command (Shift alone would type a letter) and one key: a letter, a
  /// digit, F1 to F20, Space, Home, End, PageUp or PageDown. The reason it cannot be used otherwise.
  static func parse(_ text: String) -> Result<Shortcut, ShortcutError> {
    let t = text.trimmingCharacters(in: .whitespaces)
    if t.isEmpty { return .failure(ShortcutError("Type a shortcut, such as \(defaultText).")) }
    var mods: UInt32 = 0
    var key: UInt32?
    for raw in t.split(separator: "+", omittingEmptySubsequences: false) {
      let p = raw.trimmingCharacters(in: .whitespaces)
      if let m = modifier(p) {
        if mods & m != 0 { return .failure(ShortcutError("\(p) is there twice.")) }
        mods |= m
        continue
      }
      guard let k = keyCode(p) else {
        return .failure(
          ShortcutError(
            (p.isEmpty ? "A part is empty" : "\(p) is not a key Codehouse can use")
              + ". Use a letter, a digit, F1 to F20, Space, Home, End, PageUp or PageDown."))
      }
      if key != nil { return .failure(ShortcutError("Use one key with Control, Option, Shift or Command.")) }
      key = k
    }
    guard let key else { return .failure(ShortcutError("Add a key, such as Space or a letter.")) }
    if mods & (control | option | command) == 0 {
      return .failure(ShortcutError("Add Control, Option or Command, so the shortcut does not type in other apps."))
    }
    return .success(Shortcut(mods: mods, key: key))
  }

  /// The shortcut written the one way, in Apple's order: Control, Option, Shift, Command, then the key.
  var text: String {
    var parts: [String] = []
    if mods & Self.control != 0 { parts.append("Control") }
    if mods & Self.option != 0 { parts.append("Option") }
    if mods & Self.shift != 0 { parts.append("Shift") }
    if mods & Self.command != 0 { parts.append("Command") }
    parts.append(Self.keys.first { $0.1 == key }?.0 ?? "?")
    return parts.joined(separator: "+")
  }

  /// Three shortcuts near this one that are free (isFree says so), for when another app has it: the same key with
  /// other modifiers first, then the same modifiers with other keys.
  func alternatives(isFree: (Shortcut) -> Bool) -> [String] {
    let sets: [UInt32] = [
      mods | Self.shift, Self.control | Self.shift, Self.option | Self.shift, Self.control | Self.command,
      Self.control | Self.option, Self.control | Self.option | Self.shift,
    ]
    let others: [UInt32] = [0x31, 0x26, 0x28, 0x0C, 0x05, 0x6F]  // Space, J, K, Q, G, F12
    var out: [String] = []
    var tried: [Shortcut] = [self]
    func consider(_ s: Shortcut) {
      guard out.count < 3, !tried.contains(s) else { return }
      tried.append(s)
      if isFree(s) { out.append(s.text) }
    }
    for m in sets { consider(Shortcut(mods: m, key: key)) }
    for k in others { consider(Shortcut(mods: mods, key: k)) }
    for m in sets { for k in others { consider(Shortcut(mods: m, key: k)) } }
    return out
  }
}

struct ShortcutError: Error, Equatable {
  let message: String
  init(_ m: String) { message = m }
}
