// Builds a Windows .ico from PNG files (Windows reads PNGs inside an .ico from Vista on), one entry for each size.
// Used by scripts/package.mjs for the app icon from the Codehouse visual identity pack.

/** The width and height a PNG says it has (its IHDR chunk). */
export function pngSize(png) {
  if (png.length < 24 || png.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("That is not a PNG file.")
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** One .ico holding each PNG as it is. Sizes of 256 and over are written as 0, as the format asks. */
export function icoFromPngs(pngs) {
  const head = 6 + 16 * pngs.length
  const out = Buffer.alloc(head + pngs.reduce((n, p) => n + p.length, 0))
  out.writeUInt16LE(0, 0)
  out.writeUInt16LE(1, 2)
  out.writeUInt16LE(pngs.length, 4)
  let at = head
  pngs.forEach((png, i) => {
    const { width, height } = pngSize(png)
    const e = 6 + 16 * i
    out[e] = width >= 256 ? 0 : width
    out[e + 1] = height >= 256 ? 0 : height
    out.writeUInt16LE(1, e + 4)
    out.writeUInt16LE(32, e + 6)
    out.writeUInt32LE(png.length, e + 8)
    out.writeUInt32LE(at, e + 12)
    png.copy(out, at)
    at += png.length
  })
  return out
}
