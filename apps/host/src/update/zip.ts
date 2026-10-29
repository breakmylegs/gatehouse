/**
 * The zips a release is made of: written and read here, not by a zip tool, so file names in any language survive
 * the trip (UTF-8, flagged as such) and every name is checked before anything is written. A reader that only has to
 * read these zips can be strict: plain files and folders, deflate or stored, no more files or bytes than the signed
 * release says, and nothing outside its own part of the folder.
 */
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import zlib from "node:zlib"
import { UpdateError } from "./source.js"
import { mapLimit, partOf, type PartName } from "./tree.js"

const deflate = promisify(zlib.deflateRaw)
const inflate = promisify(zlib.inflateRaw)
const UTF8 = 0x0800
const MAX = 0xffffffff

/** Writes the given files (forward-slash paths relative to root) into a zip, in that order. */
export async function writeZip(file: string, root: string, rels: string[]): Promise<void> {
  if (rels.length >= 0xffff) throw new Error("Too many files for one zip.")
  const out = await fs.promises.open(file, "w")
  const central: Buffer[] = []
  let offset = 0
  try {
    // Compress a few files ahead, write them in order.
    const batch = 16
    for (let i = 0; i < rels.length; i += batch) {
      const chunk = rels.slice(i, i + batch)
      const packed = await mapLimit(chunk, batch, async (rel) => {
        const data = await fs.promises.readFile(path.join(root, rel))
        const squeezed = await deflate(data)
        const stored = squeezed.length >= data.length
        return { rel, data, body: stored ? data : squeezed, method: stored ? 0 : 8 }
      })
      for (const p of packed) {
        const name = Buffer.from(p.rel, "utf8")
        const crc = zlib.crc32(p.data)
        if (p.data.length > MAX || offset > MAX)
          throw new Error("A release part is too large for a zip.")
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt16LE(UTF8, 6)
        local.writeUInt16LE(p.method, 8)
        local.writeUInt16LE(0, 10) // time: fixed, so the same files make the same zip
        local.writeUInt16LE(0x21, 12) // date: 1 January 1980
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(p.body.length, 18)
        local.writeUInt32LE(p.data.length, 22)
        local.writeUInt16LE(name.length, 26)
        local.writeUInt16LE(0, 28)
        await out.write(Buffer.concat([local, name, p.body]))
        const c = Buffer.alloc(46)
        c.writeUInt32LE(0x02014b50, 0)
        c.writeUInt16LE(20, 4)
        c.writeUInt16LE(20, 6)
        c.writeUInt16LE(UTF8, 8)
        c.writeUInt16LE(p.method, 10)
        c.writeUInt16LE(0, 12)
        c.writeUInt16LE(0x21, 14)
        c.writeUInt32LE(crc, 16)
        c.writeUInt32LE(p.body.length, 20)
        c.writeUInt32LE(p.data.length, 24)
        c.writeUInt16LE(name.length, 28)
        c.writeUInt32LE(offset, 42)
        central.push(c, name)
        offset += 30 + name.length + p.body.length
      }
    }
    const cd = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(rels.length, 8)
    end.writeUInt16LE(rels.length, 10)
    end.writeUInt32LE(cd.length, 12)
    end.writeUInt32LE(offset, 16)
    await out.write(Buffer.concat([cd, end]))
  } finally {
    await out.close()
  }
}

interface Entry {
  name: string
  method: number
  crc: number
  packed: number
  size: number
  offset: number
}

/** A name an update may write: a relative path inside the given part, with nothing that could climb out. */
export function allowedName(name: string, part: PartName): boolean {
  const isDir = name.endsWith("/")
  const bare = isDir ? name.slice(0, -1) : name
  const segs = bare.split("/")
  return (
    bare.length > 0 &&
    bare.length <= 400 &&
    !name.startsWith("/") &&
    !/[\\:\0]/.test(name) &&
    !segs.some((s) => s === "" || s === "." || s === "..") &&
    (isDir ? partOf(bare + "/x") : partOf(bare)) === part
  )
}

async function readEntries(
  fh: fs.promises.FileHandle,
  size: number,
  label: string,
): Promise<Entry[]> {
  const tail = Math.min(size, 65_557)
  const buf = Buffer.alloc(tail)
  await fh.read(buf, 0, tail, size - tail)
  let at = -1
  for (let i = tail - 22; i >= 0; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      at = i
      break
    }
  if (at < 0) throw new UpdateError(`${label} is not a zip.`)
  const count = buf.readUInt16LE(at + 10)
  const cdSize = buf.readUInt32LE(at + 12)
  const cdOffset = buf.readUInt32LE(at + 16)
  if (cdOffset + cdSize > size) throw new UpdateError(`${label} is damaged.`)
  const cd = Buffer.alloc(cdSize)
  await fh.read(cd, 0, cdSize, cdOffset)
  const out: Entry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50)
      throw new UpdateError(`${label} is damaged.`)
    const flags = cd.readUInt16LE(p + 8)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen)
    out.push({
      name: flags & UTF8 ? nameBytes.toString("utf8") : nameBytes.toString("latin1"),
      method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16),
      packed: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/**
 * Unpacks one part's zip into dest. Refused, before anything is written, if a name is not allowed, if an entry is
 * not plain deflate or stored, or if it holds more files or bytes than the signed release says the part has.
 * Each file is checked against its CRC as it is written.
 */
export async function extractZip(
  file: string,
  dest: string,
  part: PartName,
  limits: { files: number; bytes: number },
): Promise<number> {
  const label = path.basename(file)
  const fh = await fs.promises.open(file, "r")
  try {
    const size = (await fh.stat()).size
    const entries = await readEntries(fh, size, label)
    if (entries.length === 0) throw new UpdateError(`${label} is empty.`)
    let files = 0
    let bytes = 0
    for (const e of entries) {
      if (!allowedName(e.name, part))
        throw new UpdateError(
          `${label} holds "${e.name}", which an update may not write. It was refused.`,
        )
      if (e.name.endsWith("/")) continue
      if (e.method !== 0 && e.method !== 8)
        throw new UpdateError(`${label} uses a kind of compression JCVC does not read.`)
      files++
      bytes += e.size
    }
    if (files > limits.files || bytes > limits.bytes)
      throw new UpdateError(`${label} holds more than the signed release says. It was refused.`)
    const made = new Set<string>()
    for (const e of entries) {
      const target = path.join(dest, ...e.name.split("/").filter(Boolean))
      if (e.name.endsWith("/")) {
        await fs.promises.mkdir(target, { recursive: true })
        continue
      }
      const head = Buffer.alloc(30)
      await fh.read(head, 0, 30, e.offset)
      if (head.readUInt32LE(0) !== 0x04034b50) throw new UpdateError(`${label} is damaged.`)
      const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
      if (start + e.packed > size) throw new UpdateError(`${label} is damaged.`)
      const body = Buffer.alloc(e.packed)
      await fh.read(body, 0, e.packed, start)
      const data = e.method === 8 ? await inflate(body, { maxOutputLength: e.size + 1 }) : body
      if (data.length !== e.size || zlib.crc32(data) !== e.crc)
        throw new UpdateError(`${label} is damaged at ${e.name}.`)
      const dir = path.dirname(target)
      if (!made.has(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
        made.add(dir)
      }
      await fs.promises.writeFile(target, data)
    }
    return files
  } finally {
    await fh.close()
  }
}
