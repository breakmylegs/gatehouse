import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

/**
 * D-024, a second confirmation for loosening (Frontier build, Wave 4), the safe variant. Removing a deny rule,
 * switching off a built-in ask (a project no longer strict about its tests) or raising a project's autonomy cap needs
 * the phrase typed on the desktop, then waits ten minutes before it applies; the phone and push channels are told, for
 * information only, and you can cancel it in that time. Tightening applies at once, as before. What waits is kept in
 * the data folder, so a restart neither loses it nor skips the wait. A phone passkey in place of the wait is listed for
 * security, not built.
 */
export const COOLING_MS = 10 * 60_000

export type LooseningKind = "rules" | "test-integrity" | "autonomy"

export interface Loosening {
  id: string
  kind: LooseningKind
  /** What it loosens, in words, for the desktop, the phone and the record. */
  what: string
  /** What applying it needs: the rules file and the hash it replaces, the setting, or the project and level. */
  payload: Record<string, unknown>
  requestedAt: string
  appliesAt: string
}

/** The phrase to type for a loosening: short, and naming what it loosens. */
export const looseningPhrase = (what: string) => `loosen ${what}`.replace(/\s+/g, " ").trim().slice(0, 120)

export class LooseningStore {
  #items: Loosening[] = []
  #extra: Record<string, unknown> = {}

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      const { pending, ...rest } = raw
      this.#extra = rest
      for (const p of Array.isArray(pending) ? (pending as Array<Partial<Loosening>>) : [])
        if (p && typeof p.id === "string" && (p.kind === "rules" || p.kind === "test-integrity" || p.kind === "autonomy") && typeof p.what === "string" && typeof p.appliesAt === "string" && typeof p.requestedAt === "string" && p.payload && typeof p.payload === "object")
          this.#items.push(p as Loosening)
    } catch {
      // none yet
    }
  }

  list(): Loosening[] {
    return this.#items.map((i) => ({ ...i }))
  }

  async #save(): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify({ ...this.#extra, pending: this.#items }, null, 2) + "\n")
  }

  /** Keeps a loosening to apply once the wait is over. One of a kind and target at a time: a newer one replaces it. */
  async add(kind: LooseningKind, what: string, payload: Record<string, unknown>, key: string): Promise<Loosening> {
    const at = this.now()
    const item: Loosening = { id: crypto.randomBytes(8).toString("hex"), kind, what, payload: { ...payload, key }, requestedAt: new Date(at).toISOString(), appliesAt: new Date(at + COOLING_MS).toISOString() }
    this.#items = [...this.#items.filter((i) => !(i.kind === kind && i.payload.key === key)), item]
    await this.#save()
    return item
  }

  async remove(id: string): Promise<Loosening | undefined> {
    const item = this.#items.find((i) => i.id === id)
    if (!item) return undefined
    this.#items = this.#items.filter((i) => i.id !== id)
    await this.#save()
    return item
  }

  /** Those whose wait is over, oldest first. */
  due(): Loosening[] {
    const now = this.now()
    return this.#items.filter((i) => Date.parse(i.appliesAt) <= now).sort((a, b) => a.appliesAt.localeCompare(b.appliesAt))
  }
}
