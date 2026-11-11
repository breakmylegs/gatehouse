// The quick prompt's shortcut, held for the whole Mac with Carbon's RegisterEventHotKey. It works from any app and
// needs no Accessibility permission, because Codehouse is told only that its own shortcut was pressed: it never sees
// other keys. The rules for the text are in Shortcut.swift.
import Carbon
import Foundation

final class GlobalHotkey {
  /// Called on the main queue when the shortcut is pressed.
  static var onPress: () -> Void = {}
  private static var installed = false
  private static let signature: OSType = 0x4348_716B  // "CHqk"
  private var ref: EventHotKeyRef?
  private(set) var current: Shortcut?

  private static func installHandler() {
    guard !installed else { return }
    installed = true
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, event, _ in
        var id = EventHotKeyID()
        GetEventParameter(
          event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
          MemoryLayout<EventHotKeyID>.size, nil, &id)
        if id.signature == GlobalHotkey.signature && id.id == 1 { DispatchQueue.main.async { GlobalHotkey.onPress() } }
        return noErr
      }, 1, &spec, nil, nil)
  }

  /// Holds this shortcut instead of the one before. False, keeping the one before, when another app has it.
  func hold(_ s: Shortcut) -> Bool {
    Self.installHandler()
    if current == s, ref != nil { return true }
    var made: EventHotKeyRef?
    let status = RegisterEventHotKey(
      s.key, s.mods, EventHotKeyID(signature: Self.signature, id: 1), GetApplicationEventTarget(), 0, &made)
    guard status == noErr, let made else { return false }
    if let ref { UnregisterEventHotKey(ref) }
    ref = made
    current = s
    return true
  }

  func release() {
    if let ref { UnregisterEventHotKey(ref) }
    ref = nil
    current = nil
  }

  /// Whether the Mac would give Codehouse this shortcut now: registered, then let go at once. Ours counts as free.
  func isFree(_ s: Shortcut) -> Bool {
    if s == current { return true }
    var probe: EventHotKeyRef?
    let status = RegisterEventHotKey(
      s.key, s.mods, EventHotKeyID(signature: Self.signature, id: 2), GetApplicationEventTarget(), 0, &probe)
    guard status == noErr, let probe else { return false }
    UnregisterEventHotKey(probe)
    return true
  }
}
