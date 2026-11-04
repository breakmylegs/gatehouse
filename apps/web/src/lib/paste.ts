/**
 * A large paste becomes a card above the prompt box instead of filling it, as in Claude's desktop app (owner, 4 Nov,
 * screenshot 7f97b6). It is sent with the message as a text file in the session's attachments, the way a dropped file
 * is, so the prompt keeps only what you typed.
 */
export const PASTE_CARD_CHARS = 2000
export const PASTE_CARD_LINES = 40

/** Whether pasted text is large enough to become a card. */
export function isLargePaste(text: string): boolean {
  if (text.length > PASTE_CARD_CHARS) return true
  let lines = 1
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n" && ++lines > PASTE_CARD_LINES) return true
  return false
}

/** Text as base64 of its UTF-8 bytes, for the attach route. */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** The first few lines of a paste, for the card. */
export function pastePreview(text: string, lines = 6): string {
  return text.split(/\r?\n/).slice(0, lines).join("\n").slice(0, 400)
}
