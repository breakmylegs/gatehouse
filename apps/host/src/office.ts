/**
 * E-081, Office files (Expansion E5). Word, PowerPoint and Excel files made from an export's text (a conversation, an
 * evidence pack, a report) after the export's redaction and writing rules (W1-13, E-086), so the preview shows what
 * goes in. Each file carries the AI-generated mark twice: a visible line at the top, and in its document properties
 * (description and keywords). They are written by Codehouse itself, Office Open XML in a zip made with Node's own
 * zlib: no library is added, so there is no new dependency or licence to check (a deviation from "pinned pure JS
 * libraries", recorded in BUILD_REPORT).
 */
import zlib from "node:zlib"

export const AI_MARK = "AI-generated: made with Codehouse (Powered by Claude). Check it before relying on it."

// ---- zip ------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(b: Buffer): number {
  let c = 0xffffffff
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A zip of the entries, deflated, with a fixed date so the same input makes the same bytes. */
export function zip(entries: Array<{ name: string; data: string | Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8")
    const packed = zlib.deflateRawSync(raw)
    const name = Buffer.from(e.name, "utf8")
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, packed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + packed.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

// ---- a small Markdown reader ------------------------------------------------------------------------------------

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "para"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; rows: string[][] }

export function blocks(md: string): Block[] {
  const out: Block[] = []
  const lines = md.replace(/\r\n?/g, "\n").split("\n")
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: "para", text: para.join(" ") })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (/^```/.test(l)) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!)
      out.push({ kind: "code", lines: code })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flush()
      const rows: string[][] = []
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) {
        const cells = lines[i]!.trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"))
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
      }
      i--
      out.push({ kind: "table", rows })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l)
    if (h) {
      flush()
      out.push({ kind: "heading", level: Math.min(h[1]!.length, 3) as 1 | 2 | 3, text: h[2]!.trim() })
      continue
    }
    const b = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l)
    if (b) {
      flush()
      out.push({ kind: "bullet", text: b[1]! })
      continue
    }
    if (!l.trim()) flush()
    else para.push(l.trim())
  }
  flush()
  return out
}

/** Runs of text, bold where Markdown says **so**; other marks are taken off. */
export function runs(text: string): Array<{ text: string; bold: boolean }> {
  const plain = (s: string) => s.replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)").replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
  return text
    .split(/\*\*/)
    .map((t, i) => ({ text: plain(t), bold: i % 2 === 1 }))
    .filter((r) => r.text)
}

/** Text safe inside XML: escaped, and without the characters XML 1.0 does not allow. */
export function xml(s: string): string {
  return s
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`

function core(title: string): string {
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Codehouse</dc:creator><dc:description>${xml(AI_MARK)}</dc:description><cp:keywords>AI-generated</cp:keywords></cp:coreProperties>`
}
const APP = `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Codehouse</Application></Properties>`
const ROOT_RELS = (main: string, type: string) =>
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
const CT_PROPS = `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`
const CT_DEFAULTS = `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`

// ---- Word -------------------------------------------------------------------------------------------------------

export function docx(title: string, markdown: string): Buffer {
  const W = (r: { text: string; bold: boolean }, mono = false) =>
    `<w:r>${r.bold || mono ? `<w:rPr>${r.bold ? "<w:b/>" : ""}${mono ? `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>` : ""}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`
  const p = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs(text).map((r) => W(r)).join("")}</w:p>`
  const body: string[] = [`<w:p><w:pPr><w:pStyle w:val="AIMark"/></w:pPr>${W({ text: AI_MARK, bold: false })}</w:p>`, p(title, "Title")]
  for (const b of blocks(markdown)) {
    if (b.kind === "heading") body.push(p(b.text, `Heading${b.level}`))
    else if (b.kind === "para") body.push(p(b.text))
    else if (b.kind === "bullet") body.push(p(`• ${b.text}`, "ListParagraph"))
    else if (b.kind === "code") body.push(...b.lines.map((l) => `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${W({ text: l, bold: false }, true)}</w:p>`))
    else {
      const cols = Math.max(...b.rows.map((r) => r.length))
      const cell = (t: string, head: boolean) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${runs(t).map((r) => W({ text: r.text, bold: r.bold || head })).join("") || "<w:r><w:t></w:t></w:r>"}</w:p></w:tc>`
      body.push(
        `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${"<w:gridCol/>".repeat(cols)}</w:tblGrid>${b.rows.map((r, i) => `<w:tr>${Array.from({ length: cols }, (_, c) => cell(r[c] ?? "", i === 0)).join("")}</w:tr>`).join("")}</w:tbl>`,
        "<w:p/>",
      )
    }
  }
  const style = (id: string, name: string, rpr: string, ppr = "") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}<w:rPr>${rpr}</w:rPr></w:style>`
  const styles = `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>${style("Title", "Title", `<w:b/><w:sz w:val="36"/>`)}${style("Heading1", "heading 1", `<w:b/><w:sz w:val="30"/>`, `<w:keepNext/><w:spacing w:before="240"/>`)}${style("Heading2", "heading 2", `<w:b/><w:sz w:val="26"/>`, `<w:keepNext/><w:spacing w:before="200"/>`)}${style("Heading3", "heading 3", `<w:b/><w:sz w:val="23"/>`, `<w:keepNext/>`)}${style("ListParagraph", "List Paragraph", "", `<w:ind w:left="360"/>`)}${style("Code", "Code", `<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>`, `<w:spacing w:after="0"/>`)}${style("AIMark", "AI mark", `<w:i/><w:color w:val="595959"/><w:sz w:val="18"/>`)}</w:styles>`
  const document = `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  return zip([
    { name: "[Content_Types].xml", data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${CT_DEFAULTS}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${CT_PROPS}</Types>` },
    { name: "_rels/.rels", data: ROOT_RELS("word/document.xml", "officeDocument") },
    { name: "word/document.xml", data: document },
    { name: "word/_rels/document.xml.rels", data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", data: styles },
    { name: "docProps/core.xml", data: core(title) },
    { name: "docProps/app.xml", data: APP },
  ])
}

// ---- Excel ------------------------------------------------------------------------------------------------------

export type Cell = string | number | { formula: string; value?: number }

export interface Sheet {
  name: string
  rows: Cell[][]
}

export function colName(i: number): string {
  let s = ""
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A number written as one in a table: 1,234.5, -3, 12%, or a currency amount; undefined for anything else. */
export function numberOf(s: string): number | undefined {
  const t = s.trim().replace(/^[£$€]\s?/, "").replace(/,(?=\d{3}\b)/g, "")
  if (!/^-?\d+(\.\d+)?%?$/.test(t)) return undefined
  return t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t)
}

/** The sheets of an export: each Markdown table, or the text line by line when it has none. */
export function sheetsOf(markdown: string): Sheet[] {
  const tables = blocks(markdown).filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table")
  if (!tables.length) return [{ name: "Text", rows: markdown.split(/\r?\n/).map((l) => [l]) }]
  return tables.map((t, i) => ({ name: `Table ${i + 1}`, rows: t.rows.map((r) => r.map((c) => numberOf(c) ?? runs(c).map((x) => x.text).join(""))) }))
}

export function xlsx(title: string, sheets: Sheet[]): Buffer {
  const names = sheets.map((s, i) => (s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet ${i + 1}`))
  const sheetXml = (s: Sheet, first: boolean) => {
    const rows = [...(first ? [[AI_MARK] as Cell[]] : []), ...s.rows]
    const body = rows
      .map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
        const ref = `${colName(ci)}${ri + 1}`
        if (typeof c === "number") return Number.isFinite(c) ? `<c r="${ref}"><v>${c}</v></c>` : ""
        if (typeof c === "object") return `<c r="${ref}"><f>${xml(c.formula.replace(/^=/, ""))}</f>${c.value !== undefined ? `<v>${c.value}</v>` : ""}</c>`
        return `<c r="${ref}" t="inlineStr"${first && ri === 0 ? ` s="1"` : ""}><is><t xml:space="preserve">${xml(c)}</t></is></c>`
      }).join("")}</row>`)
      .join("")
    return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
  }
  return zip([
    { name: "[Content_Types].xml", data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${CT_DEFAULTS}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}${CT_PROPS}</Types>` },
    { name: "_rels/.rels", data: ROOT_RELS("xl/workbook.xml", "officeDocument") },
    { name: "xl/workbook.xml", data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="9"/><color rgb="FF595959"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, i === 0) })),
    { name: "docProps/core.xml", data: core(title) },
    { name: "docProps/app.xml", data: APP },
  ])
}

// ---- PowerPoint -------------------------------------------------------------------------------------------------

/** Slides from the export: the title, then one a heading (its bullets and paragraphs, cut to fit). */
export function slidesOf(title: string, markdown: string): Array<{ title: string; lines: string[] }> {
  const slides: Array<{ title: string; lines: string[] }> = [{ title, lines: [AI_MARK] }]
  let cur: { title: string; lines: string[] } | undefined
  for (const b of blocks(markdown)) {
    if (b.kind === "heading") {
      cur = { title: b.text, lines: [] }
      slides.push(cur)
      continue
    }
    if (!cur) {
      cur = { title, lines: [] }
      slides.push(cur)
    }
    const text = b.kind === "code" ? b.lines.join(" ") : b.kind === "table" ? b.rows.map((r) => r.join(", ")).join("; ") : b.text
    cur.lines.push(runs(text).map((r) => r.text).join(""))
  }
  return slides.map((s) => ({ title: s.title, lines: s.lines.slice(0, 12).map((l) => (l.length > 300 ? `${l.slice(0, 297)}...` : l)) }))
}

export function pptx(title: string, markdown: string): Buffer {
  const slides = slidesOf(title, markdown)
  const A = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
  const tree = (inner: string) => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${inner}</p:spTree></p:cSld>`
  const box = (id: number, name: string, y: number, h: number, paras: string[], size: number, bold = false) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="${y}"/><a:ext cx="11277600" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras.map((t) => `<a:p><a:r><a:rPr lang="en-GB" sz="${size}"${bold ? ` b="1"` : ""} dirty="0"/><a:t>${xml(t)}</a:t></a:r></a:p>`).join("") || "<a:p/>"}</p:txBody></p:sp>`
  const theme = `${XML_HEAD}<a:theme ${A} name="Codehouse"><a:themeElements><a:clrScheme name="Codehouse"><a:dk1><a:srgbClr val="1F2937"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0F172A"/></a:dk2><a:lt2><a:srgbClr val="F1F5F9"/></a:lt2>${["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map((n) => `<a:${n}><a:srgbClr val="2563EB"/></a:${n}>`).join("")}<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Codehouse"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Codehouse"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  const master = `${XML_HEAD}<p:sldMaster ${A}>${tree("")}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
  const layout = `${XML_HEAD}<p:sldLayout ${A} type="blank" preserve="1">${tree("")}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  const rel = (type: string, target: string, id = "rId1") => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
  const rels = (...r: string[]) => `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join("")}</Relationships>`
  const slideXml = (s: { title: string; lines: string[] }, i: number) =>
    `${XML_HEAD}<p:sld ${A}>${tree(box(2, "Title", 304800, 1143000, [s.title], i === 0 ? 4000 : 3200, true) + box(3, "Body", 1600200, 4800600, s.lines, i === 0 ? 1600 : 1800))}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  return zip([
    { name: "[Content_Types].xml", data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${CT_DEFAULTS}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}${CT_PROPS}</Types>` },
    { name: "_rels/.rels", data: ROOT_RELS("ppt/presentation.xml", "officeDocument") },
    { name: "ppt/presentation.xml", data: `${XML_HEAD}<p:presentation ${A} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: "ppt/_rels/presentation.xml.rels", data: rels(rel("slideMaster", "slideMasters/slideMaster1.xml"), rel("theme", "theme/theme1.xml", "rId2"), ...slides.map((_, i) => rel("slide", `slides/slide${i + 1}.xml`, `rId${i + 3}`))) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: master },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels(rel("slideLayout", "../slideLayouts/slideLayout1.xml"), rel("theme", "../theme/theme1.xml", "rId2")) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: layout },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: rels(rel("slideMaster", "../slideMasters/slideMaster1.xml")) },
    { name: "ppt/theme/theme1.xml", data: theme },
    ...slides.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(s, i) },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels(rel("slideLayout", "../slideLayouts/slideLayout1.xml")) },
    ]),
    { name: "docProps/core.xml", data: core(title) },
    { name: "docProps/app.xml", data: APP },
  ])
}

export const OFFICE_MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const

export function officeFile(format: keyof typeof OFFICE_MIME, title: string, markdown: string): Buffer {
  return format === "docx" ? docx(title, markdown) : format === "pptx" ? pptx(title, markdown) : xlsx(title, sheetsOf(markdown))
}
