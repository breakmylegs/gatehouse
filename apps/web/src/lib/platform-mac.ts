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
