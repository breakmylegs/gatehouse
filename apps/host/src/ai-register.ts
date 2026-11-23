/**
 * E-069, the AI system register (Expansion E5). For each project, every model its sessions used: the provider, the
 * model and what it was used for, the project's data classification (D-085), the model's data-boundary card (C-016)
 * as it stood when last used, or that it had none, and the first and last use. A model appears the first time it
 * answers in the project, from the turn's own report of the models it used. Kept in Codehouse's data folder, read
 * tolerantly, and copied as Markdown for an AI inventory or an assessment.
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { cardFor, classificationOf, type BoundaryCard, type Boundaries, type Classification } from "./boundary.js"

export interface RegisterEntry {
  provider: string
  model: string
  purpose: string
  classification: Classification
  /** The card the model's sends went by when it was last used; null when it had none. */
  card: BoundaryCard | null
  /** Whose card it is: the model's own, or its provider's. */
  cardOf?: string
  firstUse: string
  lastUse: string
  turns: number
}

export interface TurnUse {
  local: boolean
  /** Where a local session's words go, as its settings name it. */
  localLabel?: string
  purpose: string
  /** The session's model, when the turn names none. */
  model?: string
  boundaries?: Boundaries
  classifications?: Parameters<typeof classificationOf>[0]
}

/** What a newer version added to the file is kept. */
type RegisterFile = { projects: Record<string, Record<string, RegisterEntry>> } & Record<string, unknown>

export class AiRegister {
  readonly #file: string | undefined
  readonly #now: () => Date
  #data: RegisterFile = { projects: {} }
  #writing: Promise<void> = Promise.resolve()

  constructor(file?: string, now: () => Date = () => new Date()) {
    this.#file = file
    this.#now = now
    if (file && fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as RegisterFile
        if (v && typeof v.projects === "object" && v.projects) this.#data = v
      } catch {
        // A damaged register starts again empty; the next turn of each model enters it again.
      }
    }
  }

  /** Enters the models a turn used; returns the entries that are new. */
  turn(project: string, result: Record<string, unknown>, u: TurnUse): RegisterEntry[] {
    const reported = Object.keys((result.modelUsage ?? {}) as Record<string, unknown>)
    const models = reported.length ? reported : u.model ? [u.model] : []
    const now = this.#now().toISOString()
    const provider = u.local ? `On this computer${u.localLabel ? ` (${u.localLabel})` : ""}` : "Anthropic (Claude)"
    const classification = classificationOf(u.classifications, project)
    const fresh: RegisterEntry[] = []
    const byKey = (this.#data.projects[project] ??= {})
    for (const model of models) {
      const c = cardFor(u.boundaries, u.local, model)
      const key = `${provider}|${model}|${u.purpose}`
      const was = byKey[key]
      const e: RegisterEntry = {
        ...(was ?? {}),
        provider,
        model,
        purpose: u.purpose,
        classification,
        card: c ? { ...c.card } : null,
        ...(c ? { cardOf: c.of } : {}),
        firstUse: was?.firstUse ?? now,
        lastUse: now,
        turns: (was?.turns ?? 0) + 1,
      }
      if (!c) delete e.cardOf
      byKey[key] = e
      if (!was) fresh.push(e)
    }
    if (models.length) void this.flush()
    return fresh
  }

  list(project?: string): Array<RegisterEntry & { project: string }> {
    return Object.entries(this.#data.projects)
      .filter(([p]) => project === undefined || p === project)
      .flatMap(([p, byKey]) => Object.values(byKey).map((e) => ({ ...e, project: p })))
      .sort((a, b) => a.project.localeCompare(b.project) || a.firstUse.localeCompare(b.firstUse))
  }

  markdown(project?: string): string {
    const rows = this.list(project)
    const card = (e: RegisterEntry) =>
      e.card
        ? [e.cardOf && e.cardOf !== e.model ? `${e.cardOf}'s card` : "its own card", e.card.keeps && `keeps: ${e.card.keeps}`, e.card.training && `training: ${e.card.training}`, e.card.region && `region: ${e.card.region}`, e.card.zdr && `zero retention: ${e.card.zdr}`, `checked ${e.card.checkedAt ?? "never"}`].filter(Boolean).join("; ")
        : "no card"
    const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
    return [
      `# AI system register${project ? `: ${project}` : ""}`,
      "",
      "| Project | Provider | Model | Purpose | Data classification | Boundary card | First use | Last use |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...rows.map((e) => `| ${[e.project, e.provider, e.model, e.purpose, e.classification, card(e), e.firstUse.slice(0, 10), e.lastUse.slice(0, 10)].map(esc).join(" | ")} |`),
      "",
    ].join("\n")
  }

  async flush(): Promise<void> {
    const file = this.#file
    if (!file) return
    const text = JSON.stringify(this.#data, null, 2) + "\n"
    this.#writing = this.#writing.then(async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, text)
    })
    await this.#writing.catch(() => undefined)
  }
}
