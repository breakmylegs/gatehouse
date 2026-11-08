/**
 * Backlog G21: characters you cannot see, drawn where you can. Each invisible or direction-changing character in a
 * command or input is shown as a marked code such as [U+202E] in place, so a request cannot look like something it is
 * not. The text itself (what Copy gives) is unchanged.
 */
const HIDDEN = /([\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u180E\u{E0000}-\u{E007F}])/u

export const hasHidden = (text: string): boolean => HIDDEN.test(text)

const code = (ch: string) =>
  `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`

export function ShowHidden({ text }: { text: string }) {
  if (!hasHidden(text)) return <>{text}</>
  return (
    <>
      {text.split(HIDDEN).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="hidden-char" aria-label={`hidden character ${code(part)}`}>
            [{code(part)}]
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}
