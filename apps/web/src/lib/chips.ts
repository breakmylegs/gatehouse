/**
 * T-048: context as chips in the message box. A terminal excerpt, your notes on a diff, review findings or a side
 * session's answer goes into the box as one short token, ⟦terminal 1: npm test⟧, which the box draws as a chip; what
 * it stands for is kept beside the box and put in its place when you send. Delete the token and that context is not
 * sent. A file named with @ is drawn as a chip too, and is sent as it is.
 */
export type ChipKind = "terminal" | "diff" | "review" | "note"
export interface Chip {
  kind: ChipKind
  label: string
  text: string
}

export const CHIP = /⟦(terminal|diff|review|note) (\d{1,4}): ([^⟧\n]{1,60})⟧/g

/** A label short and plain enough for the token: the first line, at most 40 characters, no brackets. */
export function chipLabel(text: string): string {
  const first = text.replace(/[⟦⟧]/g, "").split(/\r?\n/).find((l) => l.trim()) ?? ""
  const t = first.trim().replace(/\s+/g, " ")
  return (t.length > 40 ? `${t.slice(0, 39)}…` : t) || "context"
}

export const chipToken = (kind: ChipKind, n: number, label: string) => `⟦${kind} ${n}: ${chipLabel(label)}⟧`

/** The text to send: each token whose chip is kept replaced by what it stands for; any other token left as typed. */
export function expandChips(text: string, chips: Readonly<Record<number, Chip>>): string {
  // The spaces either side of a token go with it, so the context starts and ends its own lines cleanly.
  const around = new RegExp(`[ \\t]*${CHIP.source}[ \\t]*`, "g")
  return text
    .replace(around, (whole, kind: string, n: string) => {
      const c = chips[Number(n)]
      return c && c.kind === kind ? `\n\n${c.text.trim()}\n\n` : whole
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
