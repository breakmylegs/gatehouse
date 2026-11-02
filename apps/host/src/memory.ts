import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

/**
 * What chats remember about you (owner's plan, W1-08, ADR 0006): short entries kept by topic, either for every chat
 * (global) or for one project. Plain JSON files under %LOCALAPPDATA%\Gatehouse\memory\. Entries are redacted before
 * they are written, written atomically, and read tolerantly: a file or entry this version cannot read is left as it
 * is, and a newer version's extra fields are kept when an entry is changed.
 */
export const MAX_TOPIC = 60
export const MAX_TEXT = 1000
export const MAX_ENTRIES = 200
/** What a chat is told at its start, at most, newest entries first. */
export const MAX_PROMPT_CHARS = 6000

export class MemoryError extends Error {
  constructor(
    readonly code: "invalid" | "full" | "missing",
    message: string,
  ) {
    super(message)
  }
}

export interface MemoryEntry {
  id: string
  topic: string
  text: string
  at: string
  /** Who made it: Claude, through the remember tool, or you, on the Memory page. */
  by: "claude" | "you"
}

/** Everyone's memory, or one project's. */
export type MemoryScope = { kind: "global" } | { kind: "project"; name: string }

const clean = (v: string) => v.replace(/\s+/g, " ").trim()

type Raw = Record<string, unknown>

export class MemoryStore {
  readonly #dir: string
  readonly #redact: (text: string) => string

  constructor(dir: string, redact: (text: string) => string = (t) => t) {
    this.#dir = path.resolve(dir)
    this.#redact = redact
  }

  #file(s: MemoryScope): string {
    if (s.kind === "global") return path.join(this.#dir, "global.json")
    // A project name is one plain name; the same check as the project store makes.
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,59}$/u.test(s.name) || s.name.includes(".."))
      throw new MemoryError("invalid", "That is not a project name.")
    return path.join(this.#dir, "projects", `${s.name}.json`)
  }

  #read(file: string): Raw[] {
    try {
      const v = JSON.parse(fs.readFileSync(file, "utf8")) as { entries?: unknown }
      return Array.isArray(v.entries)
        ? (v.entries.filter((e) => e && typeof e === "object") as Raw[])
        : []
    } catch {
      return []
    }
  }

  async #write(file: string, entries: Raw[]): Promise<void> {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify({ version: 1, entries }, null, 2) + "\n")
  }

  /** An entry as this version can use it, or undefined for one it cannot read. */
  #entry(r: Raw): MemoryEntry | undefined {
    if (typeof r.id !== "string" || typeof r.topic !== "string" || typeof r.text !== "string")
      return undefined
    return {
      id: r.id,
      topic: r.topic,
      text: r.text,
      at: typeof r.at === "string" ? r.at : new Date(0).toISOString(),
      by: r.by === "you" ? "you" : "claude",
    }
  }

  list(scope: MemoryScope): MemoryEntry[] {
    return this.#read(this.#file(scope))
      .map((r) => this.#entry(r))
      .filter((e): e is MemoryEntry => e !== undefined)
  }

  /** Every project that has a memory file. */
  projects(): string[] {
    try {
      return fs
        .readdirSync(path.join(this.#dir, "projects"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }

  async add(
    scope: MemoryScope,
    topic: string,
    text: string,
    by: MemoryEntry["by"],
  ): Promise<MemoryEntry> {
    const t = clean(this.#redact(topic))
    const body = clean(this.#redact(text))
    if (!t || t.length > MAX_TOPIC)
      throw new MemoryError("invalid", `A topic is 1 to ${MAX_TOPIC} characters.`)
    if (!body || body.length > MAX_TEXT)
      throw new MemoryError("invalid", `A memory is 1 to ${MAX_TEXT} characters.`)
    const file = this.#file(scope)
    const entries = this.#read(file)
    if (entries.length >= MAX_ENTRIES)
      throw new MemoryError(
        "full",
        `There are already ${MAX_ENTRIES} memories here. Forget some first.`,
      )
    const entry: MemoryEntry = {
      id: crypto.randomUUID().slice(0, 8),
      topic: t,
      text: body,
      at: new Date().toISOString(),
      by,
    }
    await this.#write(file, [...entries, { ...entry }])
    return entry
  }

  /** Finds an entry by id in any scope. */
  find(id: string): { scope: MemoryScope; entry: MemoryEntry } | undefined {
    const scopes: MemoryScope[] = [
      { kind: "global" },
      ...this.projects().map((name) => ({ kind: "project" as const, name })),
    ]
    for (const scope of scopes) {
      const entry = this.list(scope).find((e) => e.id === id)
      if (entry) return { scope, entry }
    }
    return undefined
  }

  async update(id: string, patch: { topic?: string; text?: string }): Promise<MemoryEntry> {
    const found = this.find(id)
    if (!found) throw new MemoryError("missing", "There is no such memory.")
    const file = this.#file(found.scope)
    const entries = this.#read(file)
    const at = entries.findIndex((e) => e.id === id)
    const next: Raw = { ...entries[at] }
    if (patch.topic !== undefined) {
      const t = clean(this.#redact(patch.topic))
      if (!t || t.length > MAX_TOPIC)
        throw new MemoryError("invalid", `A topic is 1 to ${MAX_TOPIC} characters.`)
      next.topic = t
    }
    if (patch.text !== undefined) {
      const b = clean(this.#redact(patch.text))
      if (!b || b.length > MAX_TEXT)
        throw new MemoryError("invalid", `A memory is 1 to ${MAX_TEXT} characters.`)
      next.text = b
    }
    entries[at] = next
    await this.#write(file, entries)
    return this.#entry(next)!
  }

  async remove(id: string): Promise<MemoryEntry> {
    const found = this.find(id)
    if (!found) throw new MemoryError("missing", "There is no such memory.")
    const file = this.#file(found.scope)
    await this.#write(
      file,
      this.#read(file).filter((e) => e.id !== id),
    )
    return found.entry
  }

  /** What a chat gets at its start: everyone's memory and its project's, newest first, within the size limit. */
  forChat(project?: string): Array<MemoryEntry & { scope: string }> {
    const all = [
      ...this.list({ kind: "global" }).map((e) => ({ ...e, scope: "global" })),
      ...(project
        ? this.list({ kind: "project", name: project }).map((e) => ({ ...e, scope: project }))
        : []),
    ].sort((a, b) => b.at.localeCompare(a.at))
    const out: typeof all = []
    let used = 0
    for (const e of all) {
      const cost = e.topic.length + e.text.length + 8
      if (used + cost > MAX_PROMPT_CHARS) break
      out.push(e)
      used += cost
    }
    return out
  }

  /** Everything, as Markdown you can read, keep and bring back with import. */
  exportMarkdown(): string {
    const block = (heading: string, entries: MemoryEntry[]) =>
      entries.length
        ? [`## ${heading}`, "", ...entries.map((e) => `- [${e.topic}] ${e.text}`), ""]
        : []
    return [
      "# Codehouse memory",
      "",
      ...block("Global", this.list({ kind: "global" })),
      ...this.projects().flatMap((p) =>
        block(`Project: ${p}`, this.list({ kind: "project", name: p })),
      ),
    ].join("\n")
  }

  /** Adds the entries in an export. One that is already there (same topic and text) is skipped. Returns how many were added. */
  async importMarkdown(markdown: string): Promise<{ added: number; skipped: number }> {
    let scope: MemoryScope | undefined
    let added = 0
    let skipped = 0
    for (const line of markdown.split(/\r?\n/)) {
      const h = /^##\s+(.+?)\s*$/.exec(line)
      if (h) {
        const name = h[1]!
        scope =
          name.toLowerCase() === "global"
            ? { kind: "global" }
            : name.startsWith("Project: ")
              ? { kind: "project", name: name.slice(9).trim() }
              : undefined
        continue
      }
      const m = /^-\s+\[([^\]]+)\]\s+(.+)$/.exec(line)
      if (!m || !scope) continue
      const topic = clean(this.#redact(m[1]!))
      const text = clean(this.#redact(m[2]!))
      if (this.list(scope).some((e) => e.topic === topic && e.text === text)) {
        skipped++
        continue
      }
      try {
        await this.add(scope, topic, text, "you")
        added++
      } catch {
        skipped++
      }
    }
    return { added, skipped }
  }
}
