// CH-04 (owner's Chat build): an export zip is untrusted, every byte of it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DEFAULT_LIMITS, SafeZip, safeName, ZipRefused } from "../src/chat/import/zip.js"
import { makeZip, type FixtureEntry } from "./fixtures/zip-fixture.js"

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-chatzip-"))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

let n = 0
const write = (buf: Buffer) => {
  const f = path.join(dir, `z${n++}.zip`)
  fs.writeFileSync(f, buf)
  return f
}
const refusal = async (entries: FixtureEntry[] | Buffer, limits = DEFAULT_LIMITS, depth = 1) => {
  try {
    const z = await SafeZip.open(
      write(Buffer.isBuffer(entries) ? entries : makeZip(entries)),
      limits,
      depth,
    )
    await z.close()
    return "opened"
  } catch (e) {
    return e instanceof ZipRefused ? e.code : `other: ${(e as Error).message}`
  }
}

describe("reading an export zip", () => {
  it("lists its entries and streams each one, stored or deflated, and reads ZIP64", async () => {
    for (const zip64 of [false, true]) {
      const z = await SafeZip.open(
        write(
          makeZip(
            [
              { name: "conversations.json", data: '[{"uuid":"a"}]' },
              { name: "projects/", data: "" },
              { name: "projects/p.json", data: "{}", method: 0 },
            ],
            { zip64 },
          ),
        ),
      )
      expect(z.entries.map((e) => [e.name, e.isDir])).toEqual([
        ["conversations.json", false],
        ["projects/", true],
        ["projects/p.json", false],
      ])
      expect(await z.text(z.entries[0]!)).toBe('[{"uuid":"a"}]')
      expect(await z.text(z.entries[2]!)).toBe("{}")
      await z.close()
    }
  })

  it("refuses, before unpacking anything, a name that climbs out, is absolute or is a Windows device path", async () => {
    for (const name of [
      "../evil.json",
      "a/../../evil",
      "/etc/x",
      "C:/Windows/x",
      "a\\b.json",
      "x/./y",
      "con:x",
      "",
    ])
      expect(await refusal([{ name, data: "x" }]), name).toBe("bad-name")
    expect(safeName("conversations-000.zip")).toBe(true)
    expect(safeName("projects/b7e6d5c4.json")).toBe(true)
  })

  it("refuses duplicates (in any case), links, encryption and unknown compression", async () => {
    expect(
      await refusal([
        { name: "a.json", data: "1" },
        { name: "A.JSON", data: "2" },
      ]),
    ).toBe("duplicate")
    expect(await refusal([{ name: "link", data: "/etc/passwd", mode: 0o120777, method: 0 }])).toBe(
      "link",
    )
    expect(await refusal([{ name: "plain", data: "x", mode: 0o100644 }])).toBe("opened")
    expect(await refusal([{ name: "a.json", data: "x", encrypted: true }])).toBe("encrypted")
    expect(await refusal([{ name: "a.json", data: "x", method: 99 }])).toBe("compression")
  })

  it("keeps to the limits: entries, bytes in all, ratio and depth", async () => {
    const small = { ...DEFAULT_LIMITS, entries: 2, totalBytes: 1000 }
    expect(
      await refusal(
        [1, 2, 3].map((i) => ({ name: `${i}.json`, data: "x" })),
        small,
      ),
    ).toBe("too-many")
    // 1,200 bytes unpacked over two entries, where 1,000 are allowed in all.
    expect(
      await refusal(
        [
          { name: "a.json", data: Buffer.from(Array.from({ length: 600 }, (_, i) => i % 251)) },
          {
            name: "b.json",
            data: Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 7) % 251)),
          },
        ],
        small,
      ),
    ).toBe("too-big")
    // A bomb: ten megabytes of zeros in a few kilobytes.
    expect(await refusal([{ name: "bomb.json", data: Buffer.alloc(10 * 1024 * 1024) }])).toBe(
      "ratio",
    )
    expect(await refusal([{ name: "a.json", data: "x" }], DEFAULT_LIMITS, 3)).toBe("too-deep")
  })

  it("refuses what is not a zip or is cut short", async () => {
    expect(await refusal(Buffer.from("not a zip at all, just words in a file"))).toBe("not-a-zip")
    const good = makeZip([{ name: "a.json", data: "x".repeat(50) }])
    expect(await refusal(good.subarray(0, good.length - 30))).toBe("not-a-zip")
  })

  it("stops an entry that gives more than it said, or has the wrong CRC, while it streams", async () => {
    const lies = await SafeZip.open(
      write(makeZip([{ name: "a.json", data: "x".repeat(100), claimSize: 10 }])),
    )
    await expect(lies.text(lies.entries[0]!)).rejects.toThrow(/holds more than it says|damaged/)
    await lies.close()
    const crc = await SafeZip.open(
      write(makeZip([{ name: "a.json", data: "hello", badCrc: true }])),
    )
    await expect(crc.text(crc.entries[0]!)).rejects.toThrow(/damaged/)
    await crc.close()
  })
})
