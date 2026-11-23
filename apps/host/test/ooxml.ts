// Office Open XML checks for the tests (E-081, E-085): a zip read by its central directory, each entry's CRC checked
// with Node's own zlib.crc32 (not the writer's), and a well-formedness check of each XML part.
import zlib from "node:zlib"
import { expect } from "vitest"

/** Reads a zip by its central directory, checking each entry's CRC. */
export function unzip(b: Buffer): Map<string, string> {
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(end).toBeGreaterThan(0)
  const count = b.readUInt16LE(end + 10)
  let at = b.readUInt32LE(end + 16)
  const out = new Map<string, string>()
  for (let i = 0; i < count; i++) {
    expect(b.readUInt32LE(at)).toBe(0x02014b50)
    const method = b.readUInt16LE(at + 10)
    const crc = b.readUInt32LE(at + 16)
    const size = b.readUInt32LE(at + 20)
    const nameLen = b.readUInt16LE(at + 28)
    const extra = b.readUInt16LE(at + 30)
    const comment = b.readUInt16LE(at + 32)
    const local = b.readUInt32LE(at + 42)
    const name = b.subarray(at + 46, at + 46 + nameLen).toString("utf8")
    expect(b.readUInt32LE(local)).toBe(0x04034b50)
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28)
    const raw = method === 8 ? zlib.inflateRawSync(b.subarray(start, start + size)) : b.subarray(start, start + size)
    expect(zlib.crc32(raw)).toBe(crc)
    out.set(name, raw.toString("utf8"))
    at += 46 + nameLen + extra + comment
  }
  return out
}

/** Well-formed XML: one root, every tag closed in order, attributes quoted, entities known. */
export function wellFormed(s: string): boolean {
  const body = s.replace(/^<\?xml[^?]*\?>\s*/, "")
  const stack: string[] = []
  let roots = 0
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi)) {
    if (!m[2]) return false
    if (m[1]) {
      if (stack.pop() !== m[2]) return false
    } else if (!m[4]) {
      if (!stack.length) roots++
      stack.push(m[2])
    } else if (!stack.length) roots++
  }
  return stack.length === 0 && roots === 1
}
