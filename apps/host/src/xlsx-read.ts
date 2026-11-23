/**
 * C-059, XLSX attachments (Frontier prerequisite for E5, G7). An Excel workbook read with Node's own zlib, no
 * library: its sheets' cells as text, numbers, booleans and formulas with the values Excel saved. Macros are never
 * read (vbaProject.bin and every other part but the workbook, its sheets and shared strings are ignored), external
 * links are not followed, and the reading runs in a worker thread with a memory limit, a time limit and caps on the
 * file, on each part's unpacked size and on the cells, so a hostile file (a zip bomb, a huge sheet) costs at most the
 * worker. A chat project's .xlsx knowledge file gets a Markdown copy beside it for Claude to read.
 */
import { Worker } from "node:worker_threads"
import zlib from "node:zlib"

export type XCell = string | number | boolean | { formula: string; value?: string | number | boolean }

export interface XSheet {
  name: string
  rows: XCell[][]
}

export interface Workbook {
  sheets: XSheet[]
  /** What was left out: macros, cells past the cap. */
  notes: string[]
}

export const XLSX_LIMITS = { fileBytes: 25 * 1024 * 1024, partBytes: 64 * 1024 * 1024, cells: 200_000, sheets: 50 }

/**
 * Reads a workbook. Self-contained (it is also sent to the worker as its source): it takes zlib's inflateRawSync and
 * the limits as arguments and uses nothing from outside.
 */
export function readXlsx(buf: Buffer, inflate: (b: Buffer, o: { maxOutputLength: number }) => Buffer, limits: typeof XLSX_LIMITS): Workbook {
  if (buf.length > limits.fileBytes) throw new Error(`the file is over ${limits.fileBytes / 1024 / 1024} MB`)
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error("it is not a zip file, so not an .xlsx workbook")
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const entries = new Map<string, { method: number; size: number; local: number }>()
  for (let i = 0; i < count && at + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("its zip directory is damaged")
    const nameLen = buf.readUInt16LE(at + 28)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8")
    entries.set(name, { method: buf.readUInt16LE(at + 10), size: buf.readUInt32LE(at + 20), local: buf.readUInt32LE(at + 42) })
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  const part = (name: string): string | undefined => {
    const e = entries.get(name)
    if (!e) return undefined
    if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error(`the part ${name} is damaged`)
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
    const data = buf.subarray(start, start + e.size)
    if (e.method === 0) return data.toString("utf8")
    if (e.method !== 8) throw new Error(`the part ${name} is packed in a way this reader does not know`)
    return inflate(data, { maxOutputLength: limits.partBytes }).toString("utf8")
  }
  const unescape = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => (e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : e === "amp" ? "&" : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))))
  const attr = (tag: string, n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(tag)?.[1]
  const texts = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g)].map((m) => unescape(m[1]!)).join("")
  const notes: string[] = []
  if ([...entries.keys()].some((n) => /vbaProject\.bin$/i.test(n))) notes.push("The workbook has macros; they were not read or run.")
  const wb = part("xl/workbook.xml")
  if (!wb) throw new Error("it has no workbook part")
  const rels = new Map<string, string>()
  for (const m of (part("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id")
    const target = attr(m[0], "Target")
    if (id && target && attr(m[0], "TargetMode") !== "External") rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`)
  }
  const shared = [...(part("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!))
  const colIndex = (ref: string) => {
    let n = 0
    for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "A") n = n * 26 + (ch.charCodeAt(0) - 64)
    return n - 1
  }
  let cells = 0
  const sheets: XSheet[] = []
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    if (sheets.length >= limits.sheets) {
      notes.push(`Only the first ${limits.sheets} sheets were read.`)
      break
    }
    const name = unescape(attr(m[0], "name") ?? `Sheet ${sheets.length + 1}`)
    const target = rels.get(attr(m[0], "r:id") ?? "")
    const xml = target ? part(target) : undefined
    if (!xml) continue
    const rows: XCell[][] = []
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const ri = Number(attr(r[0], "r") ?? rows.length + 1) - 1
      const row: XCell[] = []
      for (const c of r[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (++cells > limits.cells) break
        const tag = `<c${c[1]}>`
        const inner = c[2] ?? ""
        const type = attr(tag, "t")
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1]
        const f = /<f\b[^>]*>([^<]*)<\/f>/.exec(inner)?.[1]
        let value: string | number | boolean | undefined
        if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : undefined
        else if (type === "inlineStr") value = texts(inner)
        else if (type === "b") value = v === "1"
        else if (type === "str" || type === "e") value = v !== undefined ? unescape(v) : undefined
        else value = v !== undefined && v !== "" ? Number(v) : undefined
        const ci = colIndex(attr(tag, "r") ?? "")
        row[ci] = f !== undefined ? { formula: `=${unescape(f)}`, ...(value !== undefined ? { value } : {}) } : (value ?? "")
      }
      rows[ri] = Array.from(row, (x) => x ?? "")
      if (cells > limits.cells) break
    }
    sheets.push({ name, rows: Array.from(rows, (x) => x ?? []) })
    if (cells > limits.cells) {
      notes.push(`Only the first ${limits.cells} cells were read.`)
      break
    }
  }
  return { sheets, notes }
}

/** Reads a workbook in a worker thread with a memory and time limit; a hostile file costs at most the worker. */
export function readXlsxIsolated(buf: Buffer, o: { timeoutMs?: number; memoryMb?: number } = {}): Promise<Workbook> {
  const source = `const { parentPort, workerData } = require("node:worker_threads"); const zlib = require("node:zlib");
const readXlsx = ${readXlsx.toString()};
try { parentPort.postMessage({ ok: true, wb: readXlsx(Buffer.from(workerData.buf), zlib.inflateRawSync, workerData.limits) }) } catch (e) { parentPort.postMessage({ ok: false, error: String(e && e.message || e) }) }`
  return new Promise((resolve, reject) => {
    const w = new Worker(source, { eval: true, workerData: { buf, limits: XLSX_LIMITS }, resourceLimits: { maxOldGenerationSizeMb: o.memoryMb ?? 256 } })
    const timer = setTimeout(() => {
      void w.terminate()
      reject(new Error("reading the workbook took too long"))
    }, o.timeoutMs ?? 20_000)
    w.once("message", (m: { ok: boolean; wb?: Workbook; error?: string }) => {
      clearTimeout(timer)
      void w.terminate()
      if (m.ok && m.wb) resolve(m.wb)
      else reject(new Error(m.error ?? "the workbook could not be read"))
    })
    w.once("error", (e) => {
      clearTimeout(timer)
      reject(new Error(`the workbook could not be read: ${e.message}`))
    })
  })
}

/** In this process, for small files and tests. */
export const readXlsxHere = (buf: Buffer): Workbook => readXlsx(buf, zlib.inflateRawSync, XLSX_LIMITS)

/** The workbook as Markdown: a table a sheet, formulas shown with their saved values. */
export function workbookMarkdown(fileName: string, wb: Workbook): string {
  const show = (c: XCell) => (typeof c === "object" ? `${c.value ?? ""} (${c.formula})` : String(c)).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
  const out = [`# ${fileName}`, "", "Read by Codehouse from the workbook. A formula is shown with the value Excel saved for it.", ""]
  for (const n of wb.notes) out.push(`> ${n}`, "")
  for (const s of wb.sheets) {
    out.push(`## ${s.name}`, "")
    const width = Math.max(0, ...s.rows.map((r) => r.length))
    if (!width) {
      out.push("(empty)", "")
      continue
    }
    const rows = s.rows.map((r) => Array.from({ length: width }, (_, i) => show(r[i] ?? "")))
    out.push(`| ${rows[0]!.join(" | ")} |`, `|${" --- |".repeat(width)}`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`), "")
  }
  return out.join("\n")
}
