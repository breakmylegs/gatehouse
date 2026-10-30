import type { SessionMeta, SessionMetaStore } from "./session-meta.js"

/** The SDK's session functions JCVC uses (docs/sdk-notes.md, Sessions). Passed in, so tests can stand them in. */
export interface SessionSdk {
  listSessions: (o?: { dir?: string; limit?: number }) => Promise<
    Array<{
      sessionId: string
      summary: string
      lastModified: number
      customTitle?: string
      firstPrompt?: string
      cwd?: string
      gitBranch?: string
      createdAt?: number
    }>
  >
  getSessionMessages: (
    id: string,
    o?: { dir?: string; limit?: number },
  ) => Promise<Array<{ type: string; message: unknown; parent_tool_use_id: string | null }>>
  renameSession: (id: string, title: string, o?: { dir?: string }) => Promise<void>
}

export interface PastSession {
  sessionId: string
  title: string
  cwd?: string
  lastModified: number
  createdAt?: number
  gitBranch?: string
  meta: SessionMeta
}

export interface SearchHit {
  sessionId: string
  title: string
  cwd?: string
  lastModified: number
  snippets: string[]
}

/** How many past sessions a search reads, how many it returns, and how long it may take. */
export const SEARCH_SESSIONS = 100
export const SEARCH_HITS = 30
export const SEARCH_MS = 20_000
const SNIPPET = 160

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** The words of a message: what you typed and what Claude wrote, not tool calls or their output. */
export function messageText(m: { type: string; message: unknown }): string {
  const content = obj(m.message).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((c) => obj(c))
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
}

function snippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET / 2)
  const end = Math.min(text.length, at + length + SNIPPET / 2)
  return `${start > 0 ? "..." : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "..." : ""}`
}

/** Past sessions, your titles, pins and archives, and a search inside what was said in them. */
export class SessionHistory {
  readonly #sdk: SessionSdk
  readonly #meta: SessionMetaStore
  readonly #now: () => number

  constructor(sdk: SessionSdk, meta: SessionMetaStore, now: () => number = Date.now) {
    this.#sdk = sdk
    this.#meta = meta
    this.#now = now
  }

  async list(dir?: string): Promise<PastSession[]> {
    const all = await this.#sdk.listSessions({ ...(dir ? { dir } : {}), limit: SEARCH_SESSIONS })
    return all.map((s) => {
      const meta = this.#meta.get(s.sessionId)
      return {
        sessionId: s.sessionId,
        title: meta.title ?? s.customTitle ?? s.summary ?? s.firstPrompt ?? "Untitled",
        ...(s.cwd ? { cwd: s.cwd } : {}),
        lastModified: s.lastModified,
        ...(s.createdAt ? { createdAt: s.createdAt } : {}),
        ...(s.gitBranch ? { gitBranch: s.gitBranch } : {}),
        meta,
      }
    })
  }

  messages(sessionId: string, dir?: string) {
    return this.#sdk.getSessionMessages(sessionId, { ...(dir ? { dir } : {}), limit: 5000 })
  }

  /**
   * Sessions whose words contain the query, newest first, with a few lines around each match. Titles count too.
   * It stops after SEARCH_HITS sessions or SEARCH_MS, and says so.
   */
  async search(query: string): Promise<{ hits: SearchHit[]; complete: boolean }> {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return { hits: [], complete: true }
    const started = this.#now()
    const hits: SearchHit[] = []
    const sessions = (await this.list()).filter((s) => !s.meta.archived)
    for (const s of sessions) {
      if (hits.length >= SEARCH_HITS || this.#now() - started > SEARCH_MS)
        return { hits, complete: false }
      const snippets: string[] = []
      if (s.title.toLowerCase().includes(q)) snippets.push(s.title)
      let messages: Awaited<ReturnType<SessionSdk["getSessionMessages"]>> = []
      try {
        messages = await this.messages(s.sessionId, s.cwd)
      } catch {
        // a transcript that cannot be read is skipped, not fatal
      }
      for (const m of messages) {
        if (snippets.length >= 3) break
        if (m.parent_tool_use_id) continue
        const text = messageText(m)
        const at = text.toLowerCase().indexOf(q)
        if (at >= 0) snippets.push(snippet(text, at, q.length))
      }
      if (snippets.length)
        hits.push({
          sessionId: s.sessionId,
          title: s.title,
          ...(s.cwd ? { cwd: s.cwd } : {}),
          lastModified: s.lastModified,
          snippets,
        })
    }
    return { hits, complete: true }
  }

  /**
   * Sets a title, pin or archive. A new title is also written into the session's own transcript through the SDK,
   * so Claude Code shows it when you resume there; if that fails, JCVC still keeps its own copy.
   */
  async setMeta(
    sessionId: string,
    change: { title?: string | null; pinned?: boolean; archived?: boolean },
    dir?: string,
    log: (line: string) => void = () => undefined,
  ): Promise<SessionMeta> {
    const meta = await this.#meta.set(sessionId, change)
    if (meta.title && change.title)
      await this.#sdk
        .renameSession(sessionId, meta.title, dir ? { dir } : undefined)
        .catch((e: Error) => log(`could not write the title into the transcript: ${e.message}`))
    return meta
  }

  meta(sessionId: string | undefined): SessionMeta {
    return this.#meta.get(sessionId)
  }
}
