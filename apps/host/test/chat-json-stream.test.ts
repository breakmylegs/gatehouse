// CH-04: conversations.json can be about 1 GB on one line, so it is read one conversation at a time.
import { describe, expect, it } from "vitest"
import { JsonStreamError, streamArray } from "../src/chat/import/json-stream.js"

const items = [
  { uuid: "a", name: 'He said "hi" \\ there [}', n: [1, { x: "]" }], u: "café ✓ 😀" },
  "plain",
  42,
  true,
  null,
  [1, 2, [3]],
  { empty: {} },
]
const read = async (parts: Array<Buffer | string>, max?: number) => {
  const out: unknown[] = []
  for await (const v of streamArray(parts, max)) out.push(v)
  return out
}

describe("reading a large JSON array a piece at a time", () => {
  it("gives every item exactly, wherever the bytes are cut, even inside a character", async () => {
    const bytes = Buffer.from(JSON.stringify(items))
    for (let cut = 1; cut < bytes.length; cut++)
      expect(await read([bytes.subarray(0, cut), bytes.subarray(cut)]), `cut at ${cut}`).toEqual(
        items,
      )
    expect(await read([Buffer.from("﻿[ ]")])).toEqual([])
  })

  it("refuses anything that is not one whole, well-formed array", async () => {
    for (const bad of [
      "",
      "{}",
      "[1,,2]",
      "[1 2]",
      "[,1]",
      "[{]",
      "[1] x",
      '["unterminated',
      "[1,",
    ])
      await expect(read([bad]), JSON.stringify(bad)).rejects.toBeInstanceOf(JsonStreamError)
  })

  it("refuses one item too large to hold, rather than holding it", async () => {
    await expect(read([`[{"t":"${"x".repeat(5000)}"}]`], 1000)).rejects.toThrow(/too large/)
    expect(await read([`[{"t":"${"x".repeat(500)}"}]`], 1000)).toHaveLength(1)
  })

  // The owner's prompt: a synthetic 1 GB single-line conversations.json, within the memory ceiling in the plan
  // (512 MB). It takes about 15 seconds, so it runs when CODEH_BIG_IMPORT=1.
  it.skipIf(process.env.CODEH_BIG_IMPORT !== "1")(
    "reads a 1 GB file within 512 MB",
    async () => {
      const target = 1024 * 1024 * 1024
      const conv = (i: number) =>
        JSON.stringify({
          uuid: `c${i}`,
          chat_messages: [{ uuid: `m${i}`, sender: "human", text: "word ".repeat(2000) }],
        })
      async function* source() {
        yield Buffer.from("[")
        let sent = 1
        for (let i = 0; sent < target; i++) {
          const b = Buffer.from((i ? "," : "") + conv(i))
          sent += b.length
          yield b
        }
        yield Buffer.from("]")
      }
      let peak = 0
      let n = 0
      for await (const _ of streamArray(source()))
        if (++n % 5000 === 0) peak = Math.max(peak, process.memoryUsage().rss)
      expect(n).toBeGreaterThan(50_000)
      expect(peak).toBeLessThan(512 * 1024 * 1024)
    },
    300_000,
  )
})
