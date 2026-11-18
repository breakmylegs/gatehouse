// Mac fork (18 Nov): an update part for a Mac app keeps whether a file is executable and its symbolic links (Node, the
// program, the workspace links), and a link can never carry the update outside its folder. Windows' zips are unchanged.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { extractZip, writeZip } from "../src/update/zip.js"

let root: string
const of = (rel: string) => (rel.startsWith("app/") ? "app" : undefined)
const big = { files: 99, bytes: 99_999 }

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-zip-unix-"))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

/** A stored zip written byte by byte, each entry with the Unix mode given, so a test can hold what no writer would. */
function craft(name: string, entries: Array<{ name: string; data: string; mode: number }>): string {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const n = Buffer.from(e.name, "utf8")
    const d = Buffer.from(e.data, "utf8")
    const crc = zlib.crc32(d)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0)
    l.writeUInt16LE(20, 4)
    l.writeUInt16LE(0x0800, 6)
    l.writeUInt32LE(crc, 14)
    l.writeUInt32LE(d.length, 18)
    l.writeUInt32LE(d.length, 22)
    l.writeUInt16LE(n.length, 26)
    locals.push(l, n, d)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE((3 << 8) | 20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x0800, 8)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(d.length, 20)
    c.writeUInt32LE(d.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE((e.mode << 16) >>> 0, 38)
    c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += 30 + n.length + d.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  const file = path.join(root, name)
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]))
  return file
}
const FILE = 0o100644
const LINK = 0o120777
const fresh = (name: string) => fs.mkdtempSync(path.join(root, `${name}-`))

describe.skipIf(process.platform === "win32")("a Mac app's update part, through a zip", () => {
  it("keeps what is executable and the links, exactly", async () => {
    const src = fresh("src")
    fs.mkdirSync(path.join(src, "app/bin"), { recursive: true })
    fs.mkdirSync(path.join(src, "app/packages/policy"), { recursive: true })
    fs.mkdirSync(path.join(src, "app/node_modules/@gatehouse"), { recursive: true })
    fs.writeFileSync(path.join(src, "app/bin/node"), "#!/bin/sh\n", { mode: 0o755 })
    fs.writeFileSync(path.join(src, "app/packages/policy/index.js"), "x", { mode: 0o644 })
    fs.symlinkSync("../../packages/policy", path.join(src, "app/node_modules/@gatehouse/policy"))
    const rels = ["app/bin/node", "app/node_modules/@gatehouse/policy", "app/packages/policy/index.js"]
    const zip = path.join(root, "kept.zip")
    await writeZip(zip, src, rels, { unix: true })
    const dest = fresh("dest")
    expect(await extractZip(zip, dest, "app", big, { unix: true, of })).toBe(3)
    expect(fs.statSync(path.join(dest, "app/bin/node")).mode & 0o777).toBe(0o755)
    expect(fs.statSync(path.join(dest, "app/packages/policy/index.js")).mode & 0o777).toBe(0o644)
    const link = path.join(dest, "app/node_modules/@gatehouse/policy")
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(link)).toBe("../../packages/policy")
    expect(fs.readFileSync(path.join(link, "index.js"), "utf8")).toBe("x")
  })

  it("writes Windows' zips as before: made on MS-DOS, with no mode", async () => {
    const src = fresh("win")
    fs.writeFileSync(path.join(src, "a.txt"), "a", { mode: 0o755 })
    const zip = path.join(root, "win.zip")
    await writeZip(zip, src, ["a.txt"])
    const b = fs.readFileSync(zip)
    const cd = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(b.readUInt16LE(cd + 4)).toBe(20)
    expect(b.readUInt32LE(cd + 38)).toBe(0)
  })

  it("refuses a link that leaves the update, however it is written", async () => {
    for (const to of ["../../../outside", "/etc", "x/../../..", "./x", "a//b", ""]) {
      const zip = craft("out.zip", [{ name: "app/l", data: to, mode: LINK }])
      await expect(extractZip(zip, fresh("out"), "app", big, { unix: true, of }), to).rejects.toThrow(/refused/)
    }
  })

  it("never writes through a link, which could carry a later entry outside", async () => {
    // app/here points at app itself, which is inside, so it is allowed; app/here/../../x would then be outside.
    const zip = craft("through.zip", [
      { name: "app/here", data: ".", mode: LINK },
      { name: "app/here/esc", data: "../../..", mode: LINK },
    ])
    await expect(extractZip(zip, fresh("through"), "app", big, { unix: true, of })).rejects.toThrow(/refused/)
    const zip2 = craft("through2.zip", [
      { name: "app/sub/.keep", data: "", mode: FILE },
      { name: "app/l", data: "sub", mode: LINK },
      { name: "app/l/f", data: "x", mode: FILE },
    ])
    await expect(extractZip(zip2, fresh("through2"), "app", big, { unix: true, of })).rejects.toThrow(/through a link/)
  })

  it("refuses a name twice, and anything that is neither a file nor a link", async () => {
    const twice = craft("twice.zip", [
      { name: "app/a", data: "sub", mode: LINK },
      { name: "app/a", data: "x", mode: FILE },
    ])
    await expect(extractZip(twice, fresh("twice"), "app", big, { unix: true, of })).rejects.toThrow(/twice/)
    const fifo = craft("fifo.zip", [{ name: "app/p", data: "", mode: 0o010644 }])
    await expect(extractZip(fifo, fresh("fifo"), "app", big, { unix: true, of })).rejects.toThrow(/neither a file/)
  })
})
