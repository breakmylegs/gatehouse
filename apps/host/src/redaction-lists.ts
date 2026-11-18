/**
 * E-080 (expansion, Wave E1): shared redaction lists. A team's list of words to hide (client names, internal hosts) is
 * imported as a JSON file and its Ed25519 signature, made with a key you trust (Settings, Privacy: the public keys,
 * as PEM). A list can only add words: one that says to remove any, or a newer copy of a list that leaves out a word
 * the copy before had, is refused, and so is one whose signature does not check out. Its words are added to your own
 * list everywhere redaction runs (the audit log, the phone, exports); each list is shown with its source and date, and
 * each import is in the audit log, with how many words, never the words.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

const List = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/),
    source: z.string().min(1).max(200),
    date: z.string().min(1).max(40),
    terms: z.array(z.string().trim().min(2).max(200)).max(5000),
  })
  .passthrough()

export interface StoredList {
  name: string
  source: string
  date: string
  terms: string[]
  importedAt: string
  /** SHA-256 of the key that signed it, so you can see which. */
  signedBy: string
}

export class RedactionListError extends Error {}

const fingerprint = (pem: string) => crypto.createHash("sha256").update(crypto.createPublicKey(pem).export({ format: "der", type: "spki" })).digest("hex").slice(0, 16)

/** Which trusted key signed these bytes, or undefined when none did. */
export function signedByTrusted(bytes: Buffer, signature: string, trusted: readonly string[]): string | undefined {
  const sig = Buffer.from(signature.trim(), "base64")
  for (const pem of trusted) {
    try {
      const key = crypto.createPublicKey(pem)
      if (key.asymmetricKeyType !== "ed25519") continue
      if (crypto.verify(null, bytes, key, sig)) return fingerprint(pem)
    } catch {
      // not a key: tried no further
    }
  }
  return undefined
}

export class RedactionLists {
  readonly #dir: string
  #cache: StoredList[] | undefined

  constructor(dataDir: string) {
    this.#dir = path.join(dataDir, "redaction-lists")
  }

  list(): StoredList[] {
    if (this.#cache) return this.#cache
    const out: StoredList[] = []
    try {
      for (const f of fs.readdirSync(this.#dir).filter((n) => n.endsWith(".json")).sort())
        try {
          out.push(JSON.parse(fs.readFileSync(path.join(this.#dir, f), "utf8")) as StoredList)
        } catch {
          // unreadable: left out
        }
    } catch {
      // none yet
    }
    this.#cache = out
    return out
  }

  /** Every imported word, once. */
  terms(): string[] {
    return [...new Set(this.list().flatMap((l) => l.terms))]
  }

  /** Checks and keeps a list; throws RedactionListError saying why it was refused. */
  import(json: string, signature: string, trusted: readonly string[]): StoredList {
    if (!trusted.length) throw new RedactionListError("No trusted key is set, so no list can be checked. Add your team's public key in Settings first.")
    const signedBy = signedByTrusted(Buffer.from(json, "utf8"), signature, trusted)
    if (!signedBy) throw new RedactionListError("The list's signature does not check out with any trusted key, so it was not used. It may have been changed after it was signed.")
    let raw: unknown
    try {
      raw = JSON.parse(json)
    } catch {
      throw new RedactionListError("The list is not JSON.")
    }
    const r = raw as Record<string, unknown>
    if ("remove" in r || "removes" in r || "removeTerms" in r || "exclude" in r)
      throw new RedactionListError("A shared list can only add words to hide, never remove them, so this one was not used.")
    const p = List.safeParse(raw)
    if (!p.success) throw new RedactionListError("The list needs a name, a source, a date and its words (terms).")
    const was = this.list().find((l) => l.name.toLowerCase() === p.data.name.toLowerCase())
    if (was) {
      const now = new Set(p.data.terms.map((t) => t.toLowerCase()))
      const gone = was.terms.filter((t) => !now.has(t.toLowerCase()))
      if (gone.length) throw new RedactionListError(`This copy of "${was.name}" leaves out ${gone.length} word(s) the one before had, and a list can only add words, so it was not used.`)
    }
    const stored: StoredList = { name: p.data.name, source: p.data.source, date: p.data.date, terms: [...new Set(p.data.terms)], importedAt: new Date().toISOString(), signedBy }
    fs.mkdirSync(this.#dir, { recursive: true })
    const file = path.join(this.#dir, `${p.data.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}.json`)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(stored, null, 1))
    fs.renameSync(tmp, file)
    this.#cache = undefined
    return stored
  }
}

/**
 * Makes `config.redactTerms` your own words and every imported list's together, wherever it is read, while saving
 * Settings changes only your own (the setter). `ownTerms()` is what Settings shows and edits.
 */
export function withTeamTerms(config: { redactTerms: string[] }, lists: RedactionLists): { ownTerms: () => string[] } {
  let own = [...(config.redactTerms ?? [])]
  Object.defineProperty(config, "redactTerms", {
    configurable: true,
    enumerable: true,
    get: () => [...new Set([...own, ...lists.terms()])],
    set: (v: unknown) => {
      own = Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : []
    },
  })
  return { ownTerms: () => [...own] }
}

/** GET /api/redaction-lists, and POST { list, signature }: each list with its source, date and size; import audited. */
export function registerRedactionListRoutes(
  app: FastifyInstance,
  ctx: { lists: RedactionLists; trustedKeys: () => readonly string[]; record: (input: Record<string, unknown>) => Promise<boolean> },
): void {
  app.get("/api/redaction-lists", async () => ({
    lists: ctx.lists.list().map((l) => ({ name: l.name, source: l.source, date: l.date, words: l.terms.length, importedAt: l.importedAt, signedBy: l.signedBy })),
    trustedKeys: ctx.trustedKeys().length,
  }))
  app.post("/api/redaction-lists", async (req, reply) => {
    const b = (req.body ?? {}) as { list?: unknown; signature?: unknown }
    if (typeof b.list !== "string" || typeof b.signature !== "string" || b.list.length > 2_000_000)
      return reply.code(422).send({ error: "Choose the list and its signature." })
    try {
      const l = ctx.lists.import(b.list, b.signature, ctx.trustedKeys())
      const recorded = await ctx.record({ name: l.name, source: l.source, date: l.date, words: l.terms.length, signedBy: l.signedBy })
      if (!recorded) return reply.code(503).send({ error: "The import could not be recorded." })
      return { name: l.name, source: l.source, date: l.date, words: l.terms.length }
    } catch (e) {
      if (e instanceof RedactionListError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })
}
