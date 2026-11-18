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

/** A symbolic link, in a zip's Unix mode. */
const S_IFLNK = 0o120000
const S_IFREG = 0o100000
const S_IFMT = 0o170000

/** A link's target that climbs only at its start, then names folders: read as text, it lands where the system lands. */
function plainTarget(to: string): boolean {
  const segs = to.split("/")
  let i = 0
  while (segs[i] === "..") i++
  return segs.slice(i).every((s) => s !== "" && s !== "." && s !== "..")
}

/**
 * Writes the given files (forward-slash paths relative to root) into a zip, in that order. Update parts carry a fixed
 * date so the same files make the same zip; a zip for people to download can carry a real one.
 * Mac fork: with `unix`, each entry also carries its Unix mode (executable or not) and a symbolic link is stored as
 * one, its target as its content, for a Mac app's Node, program and workspace links. Without it the bytes are as before.
 */
export async function writeZip(
  file: string,
  root: string,
  rels: string[],
  opts: { date?: Date; unix?: boolean } = {},
): Promise<void> {
  const d = opts.date
  const dosTime = d
    ? (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
    : 0
  const dosDate = d
    ? ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    : 0x21
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
        const full = path.join(root, rel)
        let mode = 0
        let data: Buffer
        if (opts.unix) {
          const st = await fs.promises.lstat(full)
          mode = st.isSymbolicLink() ? S_IFLNK | 0o777 : S_IFREG | (st.mode & 0o111 ? 0o755 : 0o644)
          data = st.isSymbolicLink()
            ? Buffer.from(await fs.promises.readlink(full), "utf8")
            : await fs.promises.readFile(full)
        } else data = await fs.promises.readFile(full)
        const squeezed = await deflate(data)
        const stored = squeezed.length >= data.length
        return { rel, data, mode, body: stored ? data : squeezed, method: stored ? 0 : 8 }
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
        local.writeUInt16LE(dosTime, 10) // fixed (midnight, 1 January 1980) unless a date was given
        local.writeUInt16LE(dosDate, 12)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(p.body.length, 18)
        local.writeUInt32LE(p.data.length, 22)
        local.writeUInt16LE(name.length, 26)
        local.writeUInt16LE(0, 28)
        await out.write(Buffer.concat([local, name, p.body]))
        const c = Buffer.alloc(46)
        c.writeUInt32LE(0x02014b50, 0)
        c.writeUInt16LE(opts.unix ? (3 << 8) | 20 : 20, 4) // made by: Unix with a mode, else MS-DOS
        c.writeUInt16LE(20, 6)
        c.writeUInt16LE(UTF8, 8)
        c.writeUInt16LE(p.method, 10)
        c.writeUInt16LE(dosTime, 12)
        c.writeUInt16LE(dosDate, 14)
        c.writeUInt32LE(crc, 16)
        c.writeUInt32LE(p.body.length, 20)
        c.writeUInt32LE(p.data.length, 24)
        c.writeUInt16LE(name.length, 28)
        if (opts.unix) c.writeUInt32LE((p.mode << 16) >>> 0, 38)
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
  /** The Unix mode, when the zip was made on Unix with one. */
  mode?: number
}

/** A name an update may write: a relative path inside the given part, with nothing that could climb out. */
export function allowedName(
  name: string,
  part: string,
  of: (rel: string) => string | undefined = partOf, // Mac fork: a Mac app's parts
): boolean {
  const isDir = name.endsWith("/")
  const bare = isDir ? name.slice(0, -1) : name
  const segs = bare.split("/")
  return (
    bare.length > 0 &&
    bare.length <= 400 &&
    !name.startsWith("/") &&
    !/[\\:\0]/.test(name) &&
    !segs.some((s) => s === "" || s === "." || s === "..") &&
    (isDir ? of(bare + "/x") : of(bare)) === part
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
    const madeBy = cd.readUInt16LE(p + 4)
    const attrs = cd.readUInt32LE(p + 38)
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
      ...(madeBy >> 8 === 3 && attrs >>> 16 ? { mode: attrs >>> 16 } : {}),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/**
 * Unpacks one part's zip into dest. Refused, before anything is written, if a name is not allowed, if an entry is
 * not plain deflate or stored, or if it holds more files or bytes than the signed release says the part has.
 * Each file is checked against its CRC as it is written.
 * Mac fork: with `unix`, a file keeps whether it is executable and a symbolic link is made as one, refused when it
 * points outside dest; any other kind of entry is refused. `of` names a Mac app's parts.
 */
export async function extractZip(
  file: string,
  dest: string,
  part: PartName | string,
  limits: { files: number; bytes: number },
  opts: { unix?: boolean; of?: (rel: string) => string | undefined } = {},
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
      if (!allowedName(e.name, part, opts.of))
        throw new UpdateError(
          `${label} holds "${e.name}", which an update may not write. It was refused.`,
        )
      if (e.name.endsWith("/")) continue
      if (e.method !== 0 && e.method !== 8)
        throw new UpdateError(`${label} uses a kind of compression Codehouse does not read.`)
      const kind = (e.mode ?? S_IFREG) & S_IFMT
      if (opts.unix && kind !== S_IFREG && kind !== S_IFLNK)
        throw new UpdateError(`${label} holds "${e.name}", which is neither a file nor a link. It was refused.`)
      files++
      bytes += e.size
    }
    if (files > limits.files || bytes > limits.bytes)
      throw new UpdateError(`${label} holds more than the signed release says. It was refused.`)
    const made = new Set<string>()
    const names = new Set<string>()
    if (opts.unix) await fs.promises.mkdir(dest, { recursive: true })
    const realDest = opts.unix ? await fs.promises.realpath(dest) : dest
    for (const e of entries) {
      if (opts.unix && names.has(e.name)) throw new UpdateError(`${label} holds ${e.name} twice. It was refused.`)
      names.add(e.name)
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
        // Mac fork: nothing is written through a link, so a link cannot carry a later entry outside dest.
        if (opts.unix && path.relative(realDest, await fs.promises.realpath(dir)) !== path.relative(dest, dir))
          throw new UpdateError(`${label} would write ${e.name} through a link. It was refused.`)
        made.add(dir)
      }
      if (opts.unix && ((e.mode ?? 0) & S_IFMT) === S_IFLNK) {
        const to = data.toString("utf8")
        const lands = path.relative(path.resolve(dest), path.resolve(path.dirname(target), to))
        if (!plainTarget(to) || to.includes("\0") || path.isAbsolute(to) || lands.startsWith("..") || path.isAbsolute(lands))
          throw new UpdateError(`${label} holds a link at ${e.name} that points outside the update. It was refused.`)
        await fs.promises.symlink(to, target)
      } else if (opts.unix)
        await fs.promises.writeFile(target, data, { mode: (e.mode ?? 0) & 0o111 ? 0o755 : 0o644 })
      else await fs.promises.writeFile(target, data)
    }
    return files
  } finally {
    await fh.close()
  }
}
