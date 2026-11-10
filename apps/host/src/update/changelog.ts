/**
 * The changelog in Settings (owner, 4 Nov: "you can see every single changelog for every version. You pick the version
 * from a drop down which shows version number and the release date"). Each release carries one changelog.json with
 * every release's notes and date, made by the release from the GitHub releases themselves. Codehouse reads it the way
 * it reads updates (the public download path, or the API with a token), keeps the last copy it read, and shows that
 * when GitHub cannot be reached. Nothing is sent but the request. The notes are shown as text, never as HTML.
 */
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { compareVersions, parseVersion } from "./version.js"

/** Like the update's own files, never renamed: every installed copy looks for it. */
export const CHANGELOG_FILE = "changelog.json"
export const MAX_CHANGELOG = 4 * 1024 * 1024
/** How long a copy read from GitHub is used before it is read again, unless you ask. */
const FRESH_MS = 60 * 60_000

export interface ChangelogEntry {
  version: string
  /** When it was released, as GitHub says (ISO 8601). */
  date: string
  /** Its "What is new" notes, as markdown text. */
  notes: string
}

const Entry = z.object({
  version: z.string().max(60),
  date: z.string().max(40),
  notes: z.string().max(200_000),
})
const File = z.object({ releases: z.array(z.unknown()).max(10_000) }).passthrough()

/**
 * Every release in a changelog.json, newest first. Entries that are not a Codehouse version, or not readable, are
 * left out rather than failing the rest; a file that is not a changelog at all gives undefined.
 */
export function parseChangelog(text: string): ChangelogEntry[] | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const f = File.safeParse(raw)
  if (!f.success) return undefined
  const seen = new Set<string>()
  const out: ChangelogEntry[] = []
  for (const r of f.data.releases) {
    const e = Entry.safeParse(r)
    if (!e.success || !parseVersion(e.data.version) || seen.has(e.data.version)) continue
    seen.add(e.data.version)
    out.push({ version: e.data.version, date: e.data.date, notes: e.data.notes })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

/**
 * The "What is new" part of a GitHub release's notes, up to the next heading of the same level; the whole text, less
 * the download section, for a release written before that heading existed.
 */
export function whatIsNew(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const start = lines.findIndex((l) => /^##\s+What is new\s*$/i.test(l))
  if (start >= 0) {
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => /^##\s/.test(l))
    return (end >= 0 ? rest.slice(0, end) : rest).join("\n").trim()
  }
  const out: string[] = []
  let skipping = false
  for (const l of lines) {
    if (/^##\s/.test(l)) skipping = /^##\s+(Download|The other files)\s*$/i.test(l)
    if (!skipping) out.push(l)
  }
  return out.join("\n").trim()
}

export interface ChangelogView {
  releases: ChangelogEntry[]
  /** When the copy shown was read from GitHub. */
  readAt?: string
  /** GitHub could not be reached (or refused), so this is the last copy read, or nothing. */
  offline?: boolean
}

/** The last changelog read, kept in a file so it shows offline, and read again from GitHub at most hourly. */
export class ChangelogStore {
  readonly #file: string
  readonly #fetch: () => Promise<Buffer | undefined>
  readonly #now: () => number
  #pending: Promise<ChangelogView> | undefined

  constructor(o: {
    file: string
    fetch: () => Promise<Buffer | undefined>
    now?: () => number
  }) {
    this.#file = o.file
    this.#fetch = o.fetch
    this.#now = o.now ?? Date.now
  }

  #kept(): { releases: ChangelogEntry[]; readAt?: string } {
    try {
      const v = JSON.parse(fs.readFileSync(this.#file, "utf8")) as { readAt?: unknown }
      const releases = parseChangelog(JSON.stringify(v)) ?? []
      return { releases, ...(typeof v.readAt === "string" ? { readAt: v.readAt } : {}) }
    } catch {
      return { releases: [] }
    }
  }

  read(fresh = false): Promise<ChangelogView> {
    this.#pending ??= this.#read(fresh).finally(() => {
      this.#pending = undefined
    })
    return this.#pending
  }

  async #read(fresh: boolean): Promise<ChangelogView> {
    const kept = this.#kept()
    const age = kept.readAt ? this.#now() - Date.parse(kept.readAt) : Infinity
    if (!fresh && kept.releases.length && age < FRESH_MS) return kept
    try {
      const bytes = await this.#fetch()
      const releases = bytes ? parseChangelog(bytes.toString("utf8")) : undefined
      if (!releases) return { ...kept, offline: true }
      const readAt = new Date(this.#now()).toISOString()
      fs.mkdirSync(path.dirname(this.#file), { recursive: true })
      await writeFileAtomic(this.#file, JSON.stringify({ readAt, releases }) + "\n")
      return { releases, readAt }
    } catch {
      return { ...kept, offline: true }
    }
  }
}

/** GET /api/changelog: every release's notes, newest first; ?fresh=1 reads GitHub again now. */
export function registerChangelogRoutes(app: FastifyInstance, store: ChangelogStore): void {
  app.get("/api/changelog", async (req) => {
    const fresh = (req.query as { fresh?: string }).fresh === "1"
    return store.read(fresh)
  })
}
