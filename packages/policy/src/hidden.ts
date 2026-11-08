import type { ToolCall } from "./types.js"

/**
 * Characters you cannot see (backlog G21). In a command or a path there is no honest use for an invisible or
 * direction-changing character, so any of them makes the call go to a person. In text being written (a file's content,
 * an edit) only the two kinds used to hide meaning are counted: direction overrides and isolates (the "Trojan Source"
 * trick, which makes code read differently from how it runs) and tag characters (invisible ASCII, used to smuggle
 * instructions); zero-width joiners and the like are part of ordinary emoji and scripts there.
 */
const HIDING = /[\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/gu
const INVISIBLE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u180E\u{E0000}-\u{E007F}]/gu

/** "U+202E" for each different hidden character in the text, in the order first seen. */
function codes(text: string, re: RegExp): string[] {
  const seen: string[] = []
  for (const m of text.matchAll(re)) {
    const code = `U+${(m[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`
    if (!seen.includes(code)) seen.push(code)
  }
  return seen
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** The hidden characters in a call, named by code point, or none. */
export function hiddenCharacters(call: ToolCall): string[] {
  const i = (call.input ?? {}) as Record<string, unknown>
  const strict = [str(i.command), str(i.file_path), str(i.notebook_path), str(i.path), str(i.pattern)]
  const written = [str(i.content), str(i.new_string), str(i.new_source)]
  if (Array.isArray(i.edits))
    for (const e of i.edits)
      if (e && typeof e === "object") written.push(str((e as Record<string, unknown>).new_string))
  const found = [...codes(strict.join("\n"), INVISIBLE), ...codes(written.join("\n"), HIDING)]
  return [...new Set(found)]
}
