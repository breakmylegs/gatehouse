/**
 * E-057, a definition of done checklist (Expansion E5). A project's definition of done is `.codehouse/dod.yml`, a list
 * of items in the playbook checklist's form (E-053): each checked automatically where it says how (files changed, a
 * file exists, the change contains some text, a command passes) and otherwise ticked by hand for the session. Every
 * claim that the work is done shows the definition's status: how many items are met and which are not.
 *
 *   items:
 *     - { text: Tests added, changed: "**\/*.test.ts" }
 *     - { text: Docs updated, changed: "docs/**" }
 *     - Reviewed by a person
 */
import fs from "node:fs"
import path from "node:path"
import { parseYaml } from "@gatehouse/policy"
import { verifyPlaybook, type ChecklistItem, type ItemResult, type Playbook, type VerifyDeps } from "./playbooks.js"

/** The project's definition of done as a checklist, or undefined when it has none. */
export function readDod(root: string): Playbook | undefined {
  let v: unknown
  try {
    v = parseYaml(fs.readFileSync(path.join(root, ".codehouse", "dod.yml"), "utf8"))
  } catch {
    return undefined
  }
  const raw = Array.isArray(v) ? v : (v as { items?: unknown })?.items
  if (!Array.isArray(raw)) return undefined
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 300) : undefined)
  const checklist = raw
    .map((c): ChecklistItem | undefined => {
      if (typeof c === "string") return str(c) ? { text: str(c)! } : undefined
      const o = c as Record<string, unknown>
      const text = str(o?.text)
      return text ? { text, ...(str(o.changed) ? { changed: str(o.changed)! } : {}), ...(str(o.exists) ? { exists: str(o.exists)! } : {}), ...(str(o.contains) ? { contains: str(o.contains)! } : {}), ...(str(o.run) ? { run: str(o.run)! } : {}) } : undefined
    })
    .filter((c): c is ChecklistItem => !!c)
    .slice(0, 40)
  return checklist.length ? { id: "dod", name: "Definition of done", steps: [], checklist } : undefined
}

/** Items ticked by hand, per session. */
export class DodTicks {
  readonly #ticks = new Map<string, Set<string>>()
  tick(sessionId: string, item: string, on: boolean): void {
    const s = this.#ticks.get(sessionId) ?? new Set<string>()
    if (on) s.add(item)
    else s.delete(item)
    this.#ticks.set(sessionId, s)
  }
  of(sessionId: string): Set<string> {
    return this.#ticks.get(sessionId) ?? new Set()
  }
}

/** The definition's items checked, with what was ticked by hand counted as met for the items only a person can check. */
export async function dodItems(root: string, dod: Playbook, ticked: Set<string>, d: VerifyDeps): Promise<ItemResult[]> {
  const items = await verifyPlaybook(root, dod, d)
  return items.map((i) => (i.status === "person" && ticked.has(i.text) ? { ...i, status: "met" as const, why: "ticked by you" } : i))
}

export interface DodStatus {
  met: number
  total: number
  unmet: string[]
}

export const dodStatus = (items: ItemResult[]): DodStatus => ({
  met: items.filter((i) => i.status === "met").length,
  total: items.length,
  unmet: items.filter((i) => i.status !== "met").map((i) => (i.status === "person" ? `${i.text} (to tick)` : i.text)),
})

/** The status in words, for a claim. */
export const dodText = (s: DodStatus) => (s.unmet.length ? `Definition of done: ${s.met} of ${s.total} met; not met: ${s.unmet.join(", ")}.` : `Definition of done: all ${s.total} met.`)
