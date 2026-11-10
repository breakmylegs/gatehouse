import { StringDecoder } from "node:string_decoder"

/**
 * CH-04: the items of one large JSON array, one at a time, from a stream (conversations.json can be about 1 GB on one
 * line). Only the item being read is held, so memory stays bounded by the largest conversation, not the file; an item
 * larger than `maxItemChars` is refused. Anything that is not one well-formed array is an error, never a guess.
 */
export class JsonStreamError extends Error {}

const WS = new Set([" ", "\t", "\n", "\r"])

export async function* streamArray(
  source: AsyncIterable<Buffer | string> | Iterable<Buffer | string>,
  maxItemChars = 256 * 1024 * 1024,
): AsyncGenerator<unknown> {
  const decoder = new StringDecoder("utf8")
  let started = false
  let ended = false
  let first = true
  let inItem = false
  let kind: "nest" | "string" | "word" = "nest"
  let depth = 0
  let inString = false
  let escaped = false
  let item = ""
  let afterItem = false

  const take = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      throw new JsonStreamError("An item in the file is not valid JSON.")
    }
  }

  const feed = function* (s: string): Generator<unknown> {
    let from = -1
    const grow = (to: number) => {
      item += s.slice(from, to)
      if (item.length > maxItemChars)
        throw new JsonStreamError("One item in the file is too large to read.")
    }
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      if (ended) {
        if (!WS.has(c)) throw new JsonStreamError("The file goes on after its array ends.")
        continue
      }
      if (!started) {
        if (c === "[") started = true
        else if (!(first && c === "\uFEFF") && !WS.has(c))
          throw new JsonStreamError("The file is not a JSON array.")
        first = false
        continue
      }
      if (!inItem) {
        if (WS.has(c)) continue
        if (c === "]") {
          ended = true
          continue
        }
        if (afterItem) {
          if (c !== ",") throw new JsonStreamError("Items in the file are not separated properly.")
          afterItem = false
          continue
        }
        if (c === ",") throw new JsonStreamError("Items in the file are not separated properly.")
        inItem = true
        from = i
        depth = 0
        inString = false
        escaped = false
        kind = c === "{" || c === "[" ? "nest" : c === '"' ? "string" : "word"
        if (kind === "nest") {
          depth = 1
          continue
        }
        if (kind === "string") {
          inString = true
          continue
        }
        continue
      }
      if (from < 0) from = i
      if (inString) {
        // Most of a conversation is text: jump to the next quote or backslash instead of looking at every letter.
        if (escaped) {
          escaped = false
          continue
        }
        if (c === "\\") {
          escaped = true
          continue
        }
        if (c !== '"') {
          const q = s.indexOf('"', i)
          const b = s.indexOf("\\", i)
          const next = q < 0 ? b : b < 0 ? q : Math.min(q, b)
          if (next < 0) {
            i = s.length - 1
            continue
          }
          i = next - 1
          continue
        }
        inString = false
        if (kind === "string") {
          grow(i + 1)
          yield take(item)
          item = ""
          inItem = false
          afterItem = true
          from = -1
        }
        continue
      }
      if (kind === "word") {
        if (c === "," || c === "]" || WS.has(c)) {
          grow(i)
          yield take(item)
          item = ""
          inItem = false
          afterItem = true
          from = -1
          i--
        }
        continue
      }
      if (c === '"') inString = true
      else if (c === "{" || c === "[") depth++
      else if (c === "}" || c === "]") {
        depth--
        if (depth === 0) {
          grow(i + 1)
          yield take(item)
          item = ""
          inItem = false
          afterItem = true
          from = -1
        }
      }
    }
    if (inItem && from >= 0) grow(s.length)
  }

  for await (const chunk of source)
    yield* feed(typeof chunk === "string" ? chunk : decoder.write(chunk))
  yield* feed(decoder.end())
  if (!started || !ended)
    throw new JsonStreamError("The file ends before its array does: it is cut short.")
}
