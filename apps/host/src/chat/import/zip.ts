import fs from "node:fs"
import { Readable, Transform } from "node:stream"
import zlib from "node:zlib"

/**
 * CH-04 (owner's Chat build): reads a claude.ai export zip, treating every byte as untrusted. The whole directory is
 * read and checked first, and the zip is refused before anything is unpacked if any entry breaks a rule: a name that
 * climbs out of the folder or is absolute, a link, a duplicate name, encryption, a kind of compression other than
 * stored or deflate, too many entries, too many bytes in all, or an entry that inflates too far for its size. Each
 * entry is then streamed, never loaded whole, and stops the moment it gives more bytes than it said or a wrong CRC.
 * ZIP64 is read, since an export can pass 4 GB.
 */

export interface ZipLimits {
  /** Uncompressed bytes in all, nested zips included. */
  totalBytes: number
  /** The most one entry may inflate to, for each byte it is stored in. */
  ratio: number
  entries: number
  /** How many zips deep: the export, and the zips inside it. */
  depth: number
}

/** The owner's prompt's proposed defaults. */
export const DEFAULT_LIMITS: ZipLimits = {
  totalBytes: 10 * 1024 ** 3,
  ratio: 200,
  entries: 100_000,
  depth: 2,
}

export class ZipRefused extends Error {
  constructor(
    readonly code:
      | "not-a-zip"
      | "damaged"
      | "bad-name"
      | "duplicate"
      | "link"
      | "encrypted"
      | "compression"
      | "too-many"
      | "too-big"
      | "ratio"
      | "too-deep",
    message: string,
  ) {
    super(message)
  }
}

export interface ZipEntry {
  name: string
  isDir: boolean
  method: number
  crc: number
  packed: number
  size: number
  offset: number
}

const EOCD = 0x06054b50
const EOCD64 = 0x06064b50
const LOCATOR64 = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const UTF8 = 0x0800
const ENCRYPTED = 0x0001

/** A name the import may unpack: relative, inside the folder, and nothing Windows reads as something else. */
export function safeName(name: string): boolean {
  const bare = name.endsWith("/") ? name.slice(0, -1) : name
  if (!bare || bare.length > 1024) return false
  if (/[\\\0]/.test(name) || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false
  const segs = bare.split("/")
  return !segs.some((s) => s === "" || s === "." || s === ".." || /[:<>|"?*]/.test(s))
}

async function readAt(fh: fs.promises.FileHandle, at: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await fh.read(buf, 0, length, at)
  if (bytesRead !== length)
    throw new ZipRefused("damaged", "The zip ends early: it is damaged or cut short.")
  return buf
}

const u64 = (b: Buffer, at: number) => {
  const v = b.readBigUInt64LE(at)
  if (v > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ZipRefused("too-big", "An entry in the zip is too large.")
  return Number(v)
}

export class SafeZip {
  private constructor(
    private readonly file: string,
    private readonly fh: fs.promises.FileHandle,
    readonly entries: ZipEntry[],
    private readonly size: number,
  ) {}

  /** Reads and checks the whole directory. `budget` is shared with zips inside this one, so they count together. */
  static async open(
    file: string,
    limits: ZipLimits = DEFAULT_LIMITS,
    depth = 1,
    budget: { bytes: number } = { bytes: limits.totalBytes },
  ): Promise<SafeZip> {
    if (depth > limits.depth)
      throw new ZipRefused(
        "too-deep",
        `The export has zips inside zips more than ${limits.depth} deep.`,
      )
    const fh = await fs.promises.open(file, "r")
    try {
      const size = (await fh.stat()).size
      const entries = await SafeZip.#directory(fh, size, limits)
      const seen = new Set<string>()
      let total = 0
      for (const e of entries) {
        if (!safeName(e.name))
          throw new ZipRefused(
            "bad-name",
            `The zip holds a file it may not unpack: "${e.name.slice(0, 200)}".`,
          )
        // Windows does not tell names apart by case, so neither does the import.
        const key = e.name.replace(/\/$/, "").toLowerCase()
        if (seen.has(key))
          throw new ZipRefused("duplicate", `The zip holds "${e.name.slice(0, 200)}" twice.`)
        seen.add(key)
        if (e.isDir) continue
        if (e.method !== 0 && e.method !== 8)
          throw new ZipRefused(
            "compression",
            `"${e.name.slice(0, 200)}" uses a kind of compression the import does not read.`,
          )
        if (e.size > 0 && (e.packed === 0 || e.size / e.packed > limits.ratio))
          throw new ZipRefused(
            "ratio",
            `"${e.name.slice(0, 200)}" would grow more than ${limits.ratio} times its size. It was refused.`,
          )
        total += e.size
      }
      if (total > budget.bytes)
        throw new ZipRefused("too-big", "The export is larger, unpacked, than the import allows.")
      budget.bytes -= total
      return new SafeZip(file, fh, entries, size)
    } catch (e) {
      await fh.close()
      throw e
    }
  }

  static async #directory(
    fh: fs.promises.FileHandle,
    size: number,
    limits: ZipLimits,
  ): Promise<ZipEntry[]> {
    if (size < 22) throw new ZipRefused("not-a-zip", "This file is not a zip.")
    const tailLen = Math.min(size, 65_557)
    const tail = await readAt(fh, size - tailLen, tailLen)
    let at = -1
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === EOCD) {
        at = i
        break
      }
    if (at < 0) throw new ZipRefused("not-a-zip", "This file is not a zip.")
    let count = tail.readUInt16LE(at + 10)
    let cdSize = tail.readUInt32LE(at + 12)
    let cdOffset = tail.readUInt32LE(at + 16)
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locAt = size - tailLen + at - 20
      if (locAt < 0) throw new ZipRefused("damaged", "The zip's directory is damaged.")
      const loc = await readAt(fh, locAt, 20)
      if (loc.readUInt32LE(0) !== LOCATOR64)
        throw new ZipRefused("damaged", "The zip's directory is damaged.")
      const rec = await readAt(fh, u64(loc, 8), 56)
      if (rec.readUInt32LE(0) !== EOCD64)
        throw new ZipRefused("damaged", "The zip's directory is damaged.")
      count = u64(rec, 32)
      cdSize = u64(rec, 40)
      cdOffset = u64(rec, 48)
    }
    if (count > limits.entries)
      throw new ZipRefused("too-many", `The zip holds more than ${limits.entries} files.`)
    if (cdOffset + cdSize > size) throw new ZipRefused("damaged", "The zip's directory is damaged.")
    const cd = await readAt(fh, cdOffset, cdSize)
    const out: ZipEntry[] = []
    let p = 0
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL)
        throw new ZipRefused("damaged", "The zip's directory is damaged.")
      const madeBy = cd.readUInt16LE(p + 4) >> 8
      const flags = cd.readUInt16LE(p + 8)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const external = cd.readUInt32LE(p + 38)
      if (p + 46 + nameLen + extraLen + commentLen > cd.length)
        throw new ZipRefused("damaged", "The zip's directory is damaged.")
      const nameBytes = cd.subarray(p + 46, p + 46 + nameLen)
      const name = flags & UTF8 ? nameBytes.toString("utf8") : nameBytes.toString("latin1")
      let packed = cd.readUInt32LE(p + 20)
      let usize = cd.readUInt32LE(p + 24)
      let offset = cd.readUInt32LE(p + 42)
      // ZIP64: the real sizes and offset, for each that was too large for its field, in this order.
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)
      for (let x = 0; x + 4 <= extra.length;) {
        const id = extra.readUInt16LE(x)
        const len = extra.readUInt16LE(x + 2)
        if (id === 0x0001) {
          let q = x + 4
          const take = () => {
            if (q + 8 > x + 4 + len)
              throw new ZipRefused("damaged", "The zip's directory is damaged.")
            const v = u64(extra, q)
            q += 8
            return v
          }
          if (usize === 0xffffffff) usize = take()
          if (packed === 0xffffffff) packed = take()
          if (offset === 0xffffffff) offset = take()
        }
        x += 4 + len
      }
      if (flags & ENCRYPTED)
        throw new ZipRefused("encrypted", `"${name.slice(0, 200)}" is encrypted.`)
      // A link (Unix mode in the high half of the external attributes) could point anywhere: never followed.
      if (madeBy === 3 && ((external >>> 16) & 0xf000) === 0xa000)
        throw new ZipRefused("link", `"${name.slice(0, 200)}" is a link. Links are not unpacked.`)
      out.push({
        name,
        isDir: name.endsWith("/"),
        method: cd.readUInt16LE(p + 10),
        crc: cd.readUInt32LE(p + 16),
        packed,
        size: usize,
        offset,
      })
      p += 46 + nameLen + extraLen + commentLen
    }
    return out
  }

  /** One entry's contents as a stream: it errors the moment it gives more than it said, and on a wrong CRC at the end. */
  async stream(e: ZipEntry): Promise<Readable> {
    const head = await readAt(this.fh, e.offset, 30)
    if (head.readUInt32LE(0) !== LOCAL)
      throw new ZipRefused("damaged", `The zip is damaged at "${e.name}".`)
    const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
    if (start + e.packed > this.size)
      throw new ZipRefused("damaged", `The zip is damaged at "${e.name}".`)
    const raw =
      e.packed === 0
        ? Readable.from([])
        : fs.createReadStream(this.file, { start, end: start + e.packed - 1 })
    let got = 0
    let crc = 0
    const check = new Transform({
      transform(chunk: Buffer, _enc, done) {
        got += chunk.length
        if (got > e.size)
          return done(new ZipRefused("damaged", `"${e.name}" holds more than it says.`))
        crc = zlib.crc32(chunk, crc)
        done(null, chunk)
      },
      flush(done) {
        if (got !== e.size || crc !== e.crc)
          return done(new ZipRefused("damaged", `The zip is damaged at "${e.name}".`))
        done()
      },
    })
    const inflated = e.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw
    inflated.on("error", (err: Error) =>
      check.destroy(
        err instanceof ZipRefused
          ? err
          : new ZipRefused("damaged", `The zip is damaged at "${e.name}".`),
      ),
    )
    // Stopping early (reading only the start of a file) closes the file and the inflater under it too.
    check.on("close", () => {
      if (inflated !== raw) inflated.destroy()
      raw.destroy()
    })
    return inflated.pipe(check)
  }

  /** A small entry as text (a project, a manifest): refused above `max` bytes. */
  async text(e: ZipEntry, max = 64 * 1024 * 1024): Promise<string> {
    if (e.size > max) throw new ZipRefused("too-big", `"${e.name}" is too large to read whole.`)
    const parts: Buffer[] = []
    for await (const c of await this.stream(e)) parts.push(c as Buffer)
    return Buffer.concat(parts).toString("utf8")
  }

  /** Copies an entry to a file, for a zip inside this one. */
  async extractTo(e: ZipEntry, dest: string): Promise<void> {
    const { pipeline } = await import("node:stream/promises")
    await pipeline(await this.stream(e), fs.createWriteStream(dest, { flags: "wx" }))
  }

  async close(): Promise<void> {
    await this.fh.close()
  }
}
