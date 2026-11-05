import zlib from "node:zlib"

/**
 * Builds zips for the import's tests (CH-04), good ones and every kind of attack the reader must refuse: names that
 * climb out, links, encryption, entries that lie about their size or CRC, bombs, and ZIP64. Nothing here is real
 * export data (the prompt: never commit real export data).
 */
export interface FixtureEntry {
  name: string
  data?: Buffer | string
  /** 8 deflate (the default), 0 stored, or any other number to test an unknown method. */
  method?: number
  /** A Unix mode, set with "made by Unix", e.g. 0o120777 for a link. */
  mode?: number
  encrypted?: boolean
  /** Say this size in the directory instead of the real one. */
  claimSize?: number
  /** Store a wrong CRC. */
  badCrc?: boolean
}

export function makeZip(entries: FixtureEntry[], opts: { zip64?: boolean } = {}): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "utf8")
    const method = e.method ?? (e.name.endsWith("/") ? 0 : 8)
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw
    const crc = e.badCrc ? (zlib.crc32(raw) ^ 0xffff) >>> 0 : zlib.crc32(raw)
    const size = e.claimSize ?? raw.length
    const name = Buffer.from(e.name, "utf8")
    const flags = 0x0800 | (e.encrypted ? 1 : 0)
    const z64 = opts.zip64 === true
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(z64 ? 45 : 20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(z64 ? 0xffffffff : body.length, 18)
    local.writeUInt32LE(z64 ? 0xffffffff : size, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)
    const extra = z64 ? Buffer.alloc(4 + 24) : Buffer.alloc(0)
    if (z64) {
      extra.writeUInt16LE(0x0001, 0)
      extra.writeUInt16LE(24, 2)
      extra.writeBigUInt64LE(BigInt(size), 4)
      extra.writeBigUInt64LE(BigInt(body.length), 12)
      extra.writeBigUInt64LE(BigInt(offset), 20)
    }
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(((e.mode !== undefined ? 3 : 0) << 8) | 45, 4)
    c.writeUInt16LE(z64 ? 45 : 20, 6)
    c.writeUInt16LE(flags, 8)
    c.writeUInt16LE(method, 10)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(z64 ? 0xffffffff : body.length, 20)
    c.writeUInt32LE(z64 ? 0xffffffff : size, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt16LE(extra.length, 30)
    c.writeUInt32LE(e.mode !== undefined ? (e.mode << 16) >>> 0 : 0, 38)
    c.writeUInt32LE(z64 ? 0xffffffff : offset, 42)
    central.push(c, name, extra)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central)
  const tail: Buffer[] = []
  if (opts.zip64) {
    const rec = Buffer.alloc(56)
    rec.writeUInt32LE(0x06064b50, 0)
    rec.writeBigUInt64LE(44n, 4)
    rec.writeUInt16LE(45, 12)
    rec.writeUInt16LE(45, 14)
    rec.writeBigUInt64LE(BigInt(entries.length), 24)
    rec.writeBigUInt64LE(BigInt(entries.length), 32)
    rec.writeBigUInt64LE(BigInt(cd.length), 40)
    rec.writeBigUInt64LE(BigInt(offset), 48)
    const loc = Buffer.alloc(20)
    loc.writeUInt32LE(0x07064b50, 0)
    loc.writeBigUInt64LE(BigInt(offset + cd.length), 8)
    loc.writeUInt32LE(1, 16)
    tail.push(rec, loc)
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(opts.zip64 ? 0xffff : entries.length, 8)
  end.writeUInt16LE(opts.zip64 ? 0xffff : entries.length, 10)
  end.writeUInt32LE(opts.zip64 ? 0xffffffff : cd.length, 12)
  end.writeUInt32LE(opts.zip64 ? 0xffffffff : offset, 16)
  return Buffer.concat([...locals, cd, ...tail, end])
}
