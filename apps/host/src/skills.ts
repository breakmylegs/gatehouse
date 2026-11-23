/**
 * E-073, the skill growth tracker (Expansion E6). A local record, by language and area of the code, of the agent's
 * edits you accepted, the changes you undid, and the explanations you asked for. Where you keep undoing, or keep
 * asking for explanations, it suggests the area as a topic to learn, with why. It stays in a file on this computer, is
 * never sent anywhere, and can be deleted. It records counts and the area's name, never code or your words.
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"

export type SkillEvent = "accept" | "undo" | "explain"

export interface AreaCounts {
  language: string
  area: string
  accepts: number
  undos: number
  explains: number
  last: string
}

type SkillsFile = { areas: Record<string, AreaCounts> } & Record<string, unknown>

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", cs: "C#", java: "Java", kt: "Kotlin", go: "Go", rs: "Rust", rb: "Ruby", php: "PHP", swift: "Swift", sql: "SQL",
  ps1: "PowerShell", psm1: "PowerShell", sh: "Shell", css: "CSS", scss: "CSS", html: "HTML", yaml: "YAML", yml: "YAML", json: "JSON", md: "Markdown", tf: "Terraform", bicep: "Bicep",
}

/** The language and area of a file in a project: the area is its first two folders, as a learner would name it. */
export function areaOf(root: string, file: string): { language: string; area: string } {
  const rel = (path.isAbsolute(file) ? path.relative(root, file) : file).replace(/\\/g, "/")
  const ext = path.posix.extname(rel).slice(1).toLowerCase()
  const dirs = path.posix.dirname(rel).split("/").filter((d) => d && d !== "." && d !== "..")
  return { language: LANGUAGES[ext] ?? (ext ? ext.toUpperCase() : "Other"), area: `${path.basename(root)}/${dirs.slice(0, 2).join("/") || "(top)"}` }
}

/** A prompt that asks for an explanation, rather than for work. */
export const asksToExplain = (text: string) => /^\s*(?:please\s+)?(?:explain|why\b|what does|what is|how does|how do|walk me through|help me understand|can you explain|could you explain)/i.test(text)

export interface Suggestion {
  language: string
  area: string
  reason: string
}

export class SkillLog {
  readonly #file: string | undefined
  readonly #now: () => Date
  #data: SkillsFile = { areas: {} }

  constructor(file?: string, now: () => Date = () => new Date()) {
    this.#file = file
    this.#now = now
    if (file && fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as SkillsFile
        if (v && typeof v.areas === "object" && v.areas) this.#data = v
      } catch {
        // A damaged record starts again empty.
      }
    }
  }

  note(event: SkillEvent, at: { language: string; area: string }): void {
    const key = `${at.language}|${at.area}`
    const a = (this.#data.areas[key] ??= { language: at.language, area: at.area, accepts: 0, undos: 0, explains: 0, last: "" })
    if (event === "accept") a.accepts++
    else if (event === "undo") a.undos++
    else a.explains++
    a.last = this.#now().toISOString()
    void this.#save()
  }

  areas(): AreaCounts[] {
    return Object.values(this.#data.areas).sort((a, b) => b.undos + b.explains - (a.undos + a.explains) || a.area.localeCompare(b.area))
  }

  /** Topics to learn: where you undo often (three times, or a third of what you accepted), or ask for explanations. */
  suggestions(): Suggestion[] {
    const out: Suggestion[] = []
    for (const a of this.areas()) {
      const reasons: string[] = []
      if (a.undos >= 3 && a.undos * 3 >= a.accepts) reasons.push(`you undid ${a.undos} change(s) here, against ${a.accepts} accepted`)
      if (a.explains >= 3) reasons.push(`you asked for ${a.explains} explanation(s) here`)
      if (reasons.length) out.push({ language: a.language, area: a.area, reason: `${a.language} in ${a.area}: ${reasons.join(", and ")}.` })
    }
    return out
  }

  /** Deletes the record; returns how many areas it held. */
  async delete(): Promise<number> {
    const n = Object.keys(this.#data.areas).length
    this.#data = { ...this.#data, areas: {} }
    await this.#save()
    return n
  }

  async #save(): Promise<void> {
    if (!this.#file) return
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, JSON.stringify(this.#data, null, 2) + "\n")
  }
}
