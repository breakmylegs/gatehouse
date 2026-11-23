/**
 * E-068, data residency evidence (Expansion E5). For each session, the endpoint its words went to and that endpoint's
 * region: a Claude session goes to Anthropic's API, in the region its data-boundary card (C-016) states, or "not
 * known" when no card says; a session with a model on this computer goes nowhere remote; one through your gateway to
 * another provider goes where its card says, or "not known". The remote addresses the session's processes were seen
 * to reach (D-094's egress report) are kept with it. A statement per project and period lists them, and the regions
 * named are only ever what a card states: a region is never guessed from an address.
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { cardFor, type Boundaries } from "./boundary.js"

export const NOT_KNOWN = "not known"
export const NO_REMOTE = "none (this computer)"

export interface ResidencyUse {
  sessionId: string
  project: string
  local: boolean
  /** A local session's provider as its settings name it; undefined or "On this computer" for a model on this computer. */
  localLabel?: string
  model?: string
  boundaries?: Boundaries
  /** What D-094 saw the session's processes reach: address, and what allowed it. */
  reached?: Array<{ remote: string; why?: string; allowed: boolean }>
}

export interface SessionResidency {
  project: string
  endpoint: string
  region: string
  /** Where the region comes from: a card, or why there is none. */
  basis: string
  models: string[]
  reached: Array<{ remote: string; why?: string; allowed: boolean }>
  firstUse: string
  lastUse: string
}

type ResidencyFile = { sessions: Record<string, SessionResidency> } & Record<string, unknown>

export function placeOf(u: ResidencyUse): { endpoint: string; region: string; basis: string } {
  const onThisComputer = u.local && (!u.localLabel || /^on this computer$/i.test(u.localLabel.trim()))
  if (onThisComputer) return { endpoint: "a model runtime on this computer (127.0.0.1)", region: NO_REMOTE, basis: "the model runs on this computer" }
  const c = cardFor(u.boundaries, u.local, u.model)
  const endpoint = u.local ? `${u.localLabel}, through your gateway on this computer` : "Anthropic's API (api.anthropic.com)"
  const region = c?.card.region?.trim()
  return region ? { endpoint, region, basis: `the data-boundary card of ${c!.of}${c!.card.checkedAt ? `, checked ${c!.card.checkedAt}` : ""}` } : { endpoint, region: NOT_KNOWN, basis: c ? `the card of ${c.of} names no region` : "no data-boundary card" }
}

export class ResidencyLog {
  readonly #file: string | undefined
  readonly #now: () => Date
  #data: ResidencyFile = { sessions: {} }
  #writing: Promise<void> = Promise.resolve()

  constructor(file?: string, now: () => Date = () => new Date()) {
    this.#file = file
    this.#now = now
    if (file && fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as ResidencyFile
        if (v && typeof v.sessions === "object" && v.sessions) this.#data = v
      } catch {
        // A damaged log starts again empty.
      }
    }
  }

  /** A turn of a session: where it went, and what its processes reached. */
  turn(u: ResidencyUse): void {
    const now = this.#now().toISOString()
    const was = this.#data.sessions[u.sessionId]
    const place = placeOf(u)
    const reached = new Map((was?.reached ?? []).map((r) => [r.remote, r]))
    for (const r of u.reached ?? []) reached.set(r.remote, { remote: r.remote, allowed: r.allowed, ...(r.why ? { why: r.why } : {}) })
    this.#data.sessions[u.sessionId] = {
      ...(was ?? {}),
      project: u.project,
      ...place,
      models: [...new Set([...(was?.models ?? []), ...(u.model ? [u.model] : [])])],
      reached: [...reached.values()],
      firstUse: was?.firstUse ?? now,
      lastUse: now,
    }
    void this.flush()
  }

  /** The sessions of a project used in from..to (YYYY-MM-DD, both included). */
  sessions(project: string, from?: string, to?: string): Array<SessionResidency & { sessionId: string }> {
    return Object.entries(this.#data.sessions)
      .filter(([, s]) => s.project === project && (!from || s.lastUse.slice(0, 10) >= from) && (!to || s.firstUse.slice(0, 10) <= to))
      .map(([sessionId, s]) => ({ ...s, sessionId }))
      .sort((a, b) => a.firstUse.localeCompare(b.firstUse))
  }

  /** The statement for a project and period, as Markdown. */
  statement(project: string, from?: string, to?: string): string {
    const rows = this.sessions(project, from, to)
    const regions = [...new Set(rows.map((r) => r.region))]
    const remote = regions.filter((r) => r !== NO_REMOTE)
    const out = [
      `# Data residency statement: ${project}`,
      "",
      `Period: ${from ?? "the start of the record"} to ${to ?? "now"}. ${rows.length} session(s).`,
      "",
      rows.length
        ? remote.length
          ? `Remote regions: ${remote.join(", ")}.${remote.includes(NOT_KNOWN) ? " A region that is not known has no data-boundary card stating it." : ""}`
          : "No session sent anything to a remote region: every one used a model on this computer."
        : "No session of this project was used in the period.",
      "",
    ]
    for (const r of rows) {
      out.push(`## Session ${r.sessionId}`, "", `- ${r.firstUse.slice(0, 10)} to ${r.lastUse.slice(0, 10)}${r.models.length ? `, ${r.models.join(", ")}` : ""}`, `- Endpoint: ${r.endpoint}`, `- Region: ${r.region} (${r.basis})`)
      if (r.reached.length) out.push(`- Addresses its processes reached: ${r.reached.map((x) => `${x.remote} (${x.allowed ? (x.why ?? "allowed") : "outside its list"})`).join(", ")}`)
      out.push("")
    }
    return out.join("\n")
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
