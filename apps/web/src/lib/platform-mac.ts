/**
 * Mac fork: what changes in the interface on a Mac. Kept out of upstream's files so its changes merge without
 * conflicts; the few hooks into upstream's components are marked "Mac fork" (see docs/mac.md). The page is always on
 * the same computer as the Host, so the browser's user agent says which system this is.
 */
export const isMac = (userAgent = globalThis.navigator?.userAgent ?? ""): boolean =>
  /Macintosh|Mac OS X/.test(userAgent)

/** The system's own name for copy such as "Follow macOS": macOS on a Mac, Windows elsewhere. */
export const systemName = (mac = isMac()): string => (mac ? "macOS" : "Windows")

/** Marks the page with its platform, so mac.css applies only on a Mac. */
export function markPlatform(root: HTMLElement = document.documentElement, mac = isMac()): void {
  if (mac) root.dataset.platform = "mac"
}

/** Apple's order for modifier symbols: Control, Option, Shift, Command. */
const MODIFIERS: Record<string, { symbol: string; order: number }> = {
  Alt: { symbol: "⌥", order: 1 },
  Shift: { symbol: "⇧", order: 2 },
  Ctrl: { symbol: "⌘", order: 3 },
}
const KEYS: Record<string, string> = {
  Enter: "↩",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
}

/**
 * A shortcut as a Mac shows it: "Ctrl Shift K" becomes "⇧⌘K", "Alt Up, Alt Down" "⌥↑, ⌥↓", "Ctrl 1 to 9" "⌘1 to 9".
 * Ctrl becomes Command because every Ctrl shortcut here also answers to Command. Elsewhere the text is unchanged.
 */
export function keyLabel(keys: string, mac = isMac()): string {
  if (!mac) return keys
  return keys
    .split(", ")
    .map((chord) => {
      const words = chord.split(" ")
      const mods: Array<{ symbol: string; order: number }> = []
      while (words.length > 1 && MODIFIERS[words[0]!]) mods.push(MODIFIERS[words.shift()!]!)
      const rest = words.map((w) => KEYS[w] ?? w).join(" ")
      return (
        mods
          .sort((a, b) => a.order - b.order)
          .map((m) => m.symbol)
          .join("") + rest
      )
    })
    .join(", ")
}

/** Where the window keeps its icon while closed: the menu bar on a Mac, the tray on Windows. */
export const trayName = (mac = isMac()): string => (mac ? "menu bar" : "tray")

/**
 * The microphone button's words. On a Mac the Codehouse app starts the Mac's own Dictation, as Win+H starts Windows
 * voice typing; either way the system types the words and Codehouse hears nothing.
 */
export function voiceCopy(mac = isMac()): {
  label: string
  title: string
  setting: string
  browser: string
} {
  if (mac)
    return {
      label: "Speak (Dictation)",
      title: "Speak: your Mac types what you say here (Dictation)",
      setting:
        "It starts the Mac's own Dictation in the prompt box, and macOS types what you say for you to read before you send it. Depending on your Mac and its language, Dictation may send your voice to Apple to be recognised, so check your organisation allows it before you switch this on. Codehouse itself never hears or keeps any audio.",
      browser:
        "Voice typing is part of the Codehouse app, so there is no microphone button in a browser. Your Mac's Dictation shortcut still starts Dictation in any text box.",
    }
  return {
    label: "Speak (Windows voice typing)",
    title: "Speak: Windows types what you say here (Win+H)",
    setting:
      "It starts Windows voice typing in the prompt box (the same as Win+H), and Windows types what you say for you to read before you send it. Windows may send your voice to Microsoft to be recognised, so check your organisation allows it before you switch this on. Codehouse itself never hears or keeps any audio.",
    browser:
      "Voice typing is part of the Codehouse window, so there is no microphone button in a browser. Win+H still starts Windows voice typing in any text box.",
  }
}
