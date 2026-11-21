import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

/**
 * C-036, a local codebase index (Frontier build). Each project's text and symbols, kept in an SQLite file of its own
 * in the data folder with FTS5 for the text (Node's own SQLite: no native addon, nothing downloaded). It is brought up
 * to date incrementally: a file is read again only when its size or time changed, and one that is gone leaves the
 * index. Never indexed: version control, dependencies and build output, links, files over MAX_FILE, binaries, and
 * anything the floor would refuse to read (its secret globs, the same list checkpoints use), so the index can never
 * hold or show a secret the floor keeps out.
 */
export const MAX_FILE = 512 * 1024
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", ".next", "coverage", "target", ".venv", "venv", "__pycache__", ".codehouse", "dist-app", "dist-release"])
const BATCH = 500

export interface IndexStats {
  /** Files looked at that may be indexed. */
  files: number
  /** Read and indexed this time (new or changed). */
  indexed: number
  removed: number
  /** Left out: too large, binary, or refused by the floor. */
  skipped: number
  ms: number
}

export interface CodeSymbol {
  name: string
  kind: string
  line: number
}

const RULES: Array<{ ext: RegExp; res: Array<[RegExp, string]> }> = [
  {
    ext: /\.(m?[jt]sx?|cjs|cts|mts)$/i,
    res: [
      [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, "function"],
      [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
      [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
      [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, "type"],
      [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
      [/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, "const"],
    ],
  },
  { ext: /\.py$/i, res: [[/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, "function"], [/^\s*class\s+([A-Za-z_]\w*)/, "class"]] },
  {
    ext: /\.cs$/i,
    res: [
      [/^\s*(?:(?:public|private|internal|protected|static|sealed|abstract|partial)\s+)*(?:class|struct|interface|enum|record)\s+([A-Za-z_]\w*)/, "class"],
      [/^\s*(?:(?:public|private|internal|protected|static|override|virtual|async)\s+)+[\w<>[\],]+\s+([A-Za-z_]\w*)\s*\(/, "function"],
    ],
  },
  { ext: /\.ps1$|\.psm1$/i, res: [[/^\s*function\s+([A-Za-z_][\w-]*)/i, "function"]] },
  { ext: /\.go$/i, res: [[/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "function"], [/^type\s+([A-Za-z_]\w*)/, "type"]] },
  { ext: /\.rs$/i, res: [[/^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, "function"], [/^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, "type"]] },
]

/** The symbols a file declares, by a quick look at each line (the outline, C-031, is exact; this is for finding). */
export function symbolsOf(file: string, text: string): CodeSymbol[] {
  const rule = RULES.find((r) => r.ext.test(file))
  if (!rule) return []
  const out: CodeSymbol[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length && out.length < 2000; i++) {
    const l = lines[i]!
    if (l.length > 400) continue
    for (const [re, kind] of rule.res) {
      const m = re.exec(l)
      if (m?.[1]) {
        out.push({ name: m[1], kind, line: i + 1 })
        break
      }
    }
  }
  return out
}

/** An FTS5 query for words typed: each a quoted term, so nothing in it is read as FTS syntax. */
export function ftsQuery(q: string): string | undefined {
  const words = q.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? []
  return words.length ? words.map((w) => `"${w}"`).join(" ") : undefined
}

const isBinary = (b: Buffer) => b.subarray(0, 8000).includes(0)

export class CodeIndex {
  readonly #db: DatabaseSync
  readonly #root: string
  readonly #blocked: (absForwardSlash: string) => boolean
  #busy: Promise<IndexStats> | undefined
  lastRefresh = 0

  /** The index for `root`, in `dir`. `blocked` says whether the floor would refuse to read a file. */
  constructor(o: { dir: string; root: string; blocked: (absForwardSlash: string) => boolean }) {
    this.#root = path.resolve(o.root)
    this.#blocked = o.blocked
    fs.mkdirSync(o.dir, { recursive: true })
    const name = crypto.createHash("sha256").update(this.#root.toLowerCase()).digest("hex").slice(0, 24)
    this.#db = new DatabaseSync(path.join(o.dir, `${name}.sqlite`))
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL, docid INTEGER);
      CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(path UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2 tokenchars _');
      CREATE TABLE IF NOT EXISTS symbols (path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS symbols_name ON symbols (name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS symbols_path ON symbols (path);
    `)
  }

  close(): void {
    this.#db.close()
  }

  /** Brings the index up to date; one at a time. */
  refresh(): Promise<IndexStats> {
    this.#busy ??= this.#refresh().finally(() => (this.#busy = undefined))
    return this.#busy
  }

  async #refresh(): Promise<IndexStats> {
    const start = Date.now()
    // A file's text is found by its rowid in docs, never by path: path is not indexed there, so a delete by path would
    // read the whole table for every file.
    const known = new Map<string, { mtime: number; size: number; docid: number | null }>()
    for (const r of this.#db.prepare("SELECT path, mtime, size, docid FROM files").all() as unknown as Array<{ path: string; mtime: number; size: number; docid: number | null }>)
      known.set(r.path, { mtime: r.mtime, size: r.size, docid: r.docid })
    const stats: IndexStats = { files: 0, indexed: 0, removed: 0, skipped: 0, ms: 0 }
    const seen = new Set<string>()
    const upsertFile = this.#db.prepare("INSERT INTO files (path, mtime, size, docid) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, docid = excluded.docid")
    const dropDoc = this.#db.prepare("DELETE FROM docs WHERE rowid = ?")
    const dropSyms = this.#db.prepare("DELETE FROM symbols WHERE path = ?")
    const dropFile = this.#db.prepare("DELETE FROM files WHERE path = ?")
    const addDoc = this.#db.prepare("INSERT INTO docs (path, body) VALUES (?, ?)")
    const addSym = this.#db.prepare("INSERT INTO symbols (path, name, kind, line) VALUES (?, ?, ?, ?)")
    let pending = 0
    const begin = () => this.#db.exec("BEGIN")
    const commit = () => this.#db.exec("COMMIT")
    begin()
    try {
      const stack = [this.#root]
      while (stack.length) {
        const dir = stack.pop()!
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const e of entries) {
          const abs = path.join(dir, e.name)
          if (e.isSymbolicLink()) continue
          if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name.toLowerCase())) stack.push(abs)
            continue
          }
          if (!e.isFile()) continue
          const rel = path.relative(this.#root, abs).split(path.sep).join("/")
          if (this.#blocked(abs.split(path.sep).join("/"))) {
            stats.skipped++
            continue
          }
          let st: fs.Stats
          try {
            st = fs.statSync(abs)
          } catch {
            continue
          }
          if (st.size > MAX_FILE) {
            stats.skipped++
            continue
          }
          stats.files++
          seen.add(rel)
          const was = known.get(rel)
          const mtime = Math.floor(st.mtimeMs)
          if (was && was.mtime === mtime && was.size === st.size) continue
          let buf: Buffer
          try {
            buf = fs.readFileSync(abs)
          } catch {
            continue
          }
          if (was?.docid != null) dropDoc.run(was.docid)
          if (was) dropSyms.run(rel)
          if (isBinary(buf)) {
            stats.skipped++
            upsertFile.run(rel, mtime, st.size, null)
            continue
          }
          const text = buf.toString("utf8")
          const docid = Number(addDoc.run(rel, text).lastInsertRowid)
          for (const s of symbolsOf(rel, text)) addSym.run(rel, s.name, s.kind, s.line)
          upsertFile.run(rel, mtime, st.size, docid)
          stats.indexed++
          if (++pending >= BATCH) {
            commit()
            begin()
            pending = 0
            // Let the Host answer between batches.
            await new Promise((r) => setImmediate(r))
          }
        }
      }
      for (const [rel, was] of known)
        if (!seen.has(rel)) {
          if (was.docid != null) dropDoc.run(was.docid)
          dropSyms.run(rel)
          dropFile.run(rel)
          stats.removed++
        }
      commit()
    } catch (e) {
      try {
        this.#db.exec("ROLLBACK")
      } catch {
        // nothing open
      }
      throw e
    }
    stats.ms = Date.now() - start
    this.lastRefresh = Date.now()
    return stats
  }

  /** Files holding all the words, best first, with the matching part marked by [ and ]. */
  search(q: string, limit = 50): Array<{ path: string; snippet: string }> {
    const fq = ftsQuery(q)
    if (!fq) return []
    return this.#db
      .prepare("SELECT path, snippet(docs, 1, '[', ']', '...', 12) AS snippet FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?")
      .all(fq, Math.min(Math.max(limit, 1), 200)) as unknown as Array<{ path: string; snippet: string }>
  }

  /** Symbols whose name starts with `prefix`, case-insensitive. */
  symbols(prefix: string, limit = 50): Array<{ path: string } & CodeSymbol> {
    const p = prefix.trim()
    if (!p || p.length > 100) return []
    const like = `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    return this.#db
      .prepare("SELECT path, name, kind, line FROM symbols WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY length(name), name LIMIT ?")
      .all(like, Math.min(Math.max(limit, 1), 200)) as unknown as Array<{ path: string } & CodeSymbol>
  }
}
