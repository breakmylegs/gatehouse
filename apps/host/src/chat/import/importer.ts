import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ChatStore } from "../db.js"
import { streamArray } from "./json-stream.js"
import { kindOf, mapConversation, mapMemories, mapProject, type Skipped } from "./map.js"
import type { ImportCounts } from "./writer.js"
import { DEFAULT_LIMITS, SafeZip, type ZipEntry, type ZipLimits } from "./zip.js"

export class ImportError extends Error {
  constructor(
    message: string,
    /** For an export Codehouse does not recognise: the files it holds. */
    readonly files?: string[],
  ) {
    super(message)
  }
}

export interface ImportReport {
  layout: "single" | "per-project" | "manifest"
  zipSha256: string
  counts: ImportCounts
  /** Records left out, and why: the first 50. */
  skipped: Skipped[]
  batchId: string
}

/** The zip's fingerprint, for the audit, read a piece at a time. */
export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256")
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer)
  return h.digest("hex")
}

interface Source {
  zip: SafeZip
  entry: ZipEntry
}

/** The first thing a JSON file holds: an array or one object. */
async function firstChar(s: Source): Promise<string | undefined> {
  const stream = await s.zip.stream(s.entry)
  try {
    for await (const chunk of stream) {
      const m = /[^\s\uFEFF]/.exec((chunk as Buffer).toString("utf8"))
      if (m) return m[0]
    }
    return undefined
  } finally {
    stream.destroy()
  }
}

async function firstItem(s: Source): Promise<unknown> {
  const stream = await s.zip.stream(s.entry)
  try {
    for await (const item of streamArray(stream)) return item
    return undefined
  } finally {
    stream.destroy()
  }
}

/**
 * CH-04: imports a claude.ai export zip into Chat's store. The zip and every zip inside it are checked whole before
 * anything is read (zip.ts); each JSON file is told apart by what it holds, so all three layouts in the owner's report
 * import the same way; conversations are read one at a time (json-stream.ts); and everything is written in one
 * transaction, redacted first, so a failure leaves nothing behind. Project instructions and memory arrive inactive.
 */
export async function importExport(o: {
  file: string
  store: ChatStore
  limits?: ZipLimits
  /** Where zips inside the export are unpacked while they are read. */
  tmpDir?: string
}): Promise<ImportReport> {
  const limits = o.limits ?? DEFAULT_LIMITS
  const zipSha256 = await sha256File(o.file)
  const budget = { bytes: limits.totalBytes }
  const opened: SafeZip[] = []
  const work = fs.mkdtempSync(path.join(o.tmpDir ?? os.tmpdir(), "codeh-import-"))
  try {
    const root = await SafeZip.open(o.file, limits, 1, budget)
    opened.push(root)
    const sources: Source[] = []
    let nested = false
    for (const e of root.entries) {
      if (e.isDir) continue
      const lower = e.name.toLowerCase()
      if (lower.endsWith(".json")) sources.push({ zip: root, entry: e })
      else if (lower.endsWith(".zip")) {
        nested = true
        const dest = path.join(work, `${opened.length}.zip`)
        await root.extractTo(e, dest)
        const inner = await SafeZip.open(dest, limits, 2, budget)
        opened.push(inner)
        for (const ie of inner.entries)
          if (!ie.isDir && ie.name.toLowerCase().endsWith(".json"))
            sources.push({ zip: inner, entry: ie })
      }
    }
    // Each file by what it holds, not by its name.
    const conversations: Source[] = []
    const projects: unknown[] = []
    const memories: unknown[] = []
    for (const s of sources) {
      const head = await firstChar(s)
      if (head === "[") {
        const first = await firstItem(s)
        const kind = kindOf([first])
        if (kind === "conversations") conversations.push(s)
        else if (kind === "projects" || kind === "memories") {
          for await (const item of streamArray(await s.zip.stream(s.entry)))
            (kind === "projects" ? projects : memories).push(item)
        }
      } else if (head === "{") {
        const value = JSON.parse(await s.zip.text(s.entry)) as unknown
        const kind = kindOf(value)
        if (kind === "project") projects.push(value)
        else if (kind === "memories") memories.push(value)
      }
    }
    if (!conversations.length && !projects.length && !memories.length)
      throw new ImportError(
        "This does not look like a claude.ai export: Codehouse found no conversations, projects or memory in it.",
        [
          ...root.entries.map((e) => e.name),
          ...opened.slice(1).flatMap((z) => z.entries.map((e) => e.name)),
        ].slice(0, 200),
      )
    const layout: ImportReport["layout"] = nested
      ? "manifest"
      : sources.some((s) => /(^|\/)projects\//i.test(s.entry.name))
        ? "per-project"
        : "single"
    const batchId = randomUUID()
    const writer = o.store.beginImport({
      id: batchId,
      zipSha256,
      layout,
      exportDate: fs.statSync(o.file).mtime.toISOString(),
    })
    const skipped: Skipped[] = []
    const skip = (s: Skipped) => {
      if (skipped.length < 50) skipped.push(s)
    }
    try {
      for (const p of projects) {
        const m = mapProject(p)
        if ("why" in m) skip(m)
        else writer.project(m)
      }
      for (const s of conversations)
        for await (const raw of streamArray(await s.zip.stream(s.entry))) {
          const c = mapConversation(raw)
          if ("why" in c) skip(c)
          else writer.conversation(c)
        }
      for (const m of memories) for (const entry of mapMemories(m)) writer.memory(entry)
      const counts = writer.commit()
      return { layout, zipSha256, counts, skipped, batchId }
    } catch (e) {
      writer.rollback()
      throw e
    }
  } finally {
    for (const z of opened) await z.close().catch(() => undefined)
    fs.rmSync(work, { recursive: true, force: true })
  }
}
