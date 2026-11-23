/**
 * E-075, the onboarding curriculum (Expansion E6). For each project, a path to follow in order: its tours (D-079),
 * then its key terms (D-083's glossary: the words its names use most), then the code reading drills (E-074), then its
 * starter tasks. Every step links to its material: a tour to its first step's code, a term to where it is used, the
 * drills to the tours they come from, a task to its file. Starter tasks are the project's own, in
 * .codehouse/onboarding.yml; without one, the path says how to add them. Your progress is kept per project on this
 * computer, and survives a restart.
 */
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { Term } from "./glossary.js"
import type { CheckedStep, Tour } from "./tours.js"

export interface Material {
  file: string
  line?: number
  /** The panel that holds it, when it is one. */
  panel?: "tours"
}

export interface CurriculumStep {
  id: string
  kind: "tour" | "term" | "drills" | "task"
  title: string
  detail: string
  link: Material
}

export interface StarterTask {
  title: string
  file: string
  line?: number
  note?: string
}

export const ONBOARDING_FILE = path.join(".codehouse", "onboarding.yml")

/** The project's own starter tasks, read tolerantly. */
export function starterTasks(root: string): StarterTask[] {
  try {
    const v = parseYaml(fs.readFileSync(path.join(root, ONBOARDING_FILE), "utf8")) as { starter?: unknown }
    if (!Array.isArray(v?.starter)) return []
    return (v.starter as Array<Record<string, unknown>>)
      .filter((t) => typeof t?.title === "string" && typeof t.file === "string")
      .slice(0, 30)
      .map((t) => ({ title: String(t.title), file: String(t.file).replace(/\\/g, "/"), ...(typeof t.line === "number" ? { line: t.line } : {}), ...(typeof t.note === "string" ? { note: t.note } : {}) }))
  } catch {
    return []
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)

export function curriculum(o: { tours: Array<{ tour: Tour; steps: CheckedStep[] }>; terms: Term[]; starter: StarterTask[]; exists: (file: string) => boolean }): CurriculumStep[] {
  const steps: CurriculumStep[] = []
  const live = o.tours.map((t) => ({ ...t, first: t.steps.find((s) => s.state !== "gone" && s.at) })).filter((t) => t.first?.at)
  for (const t of live)
    steps.push({ id: `tour:${t.tour.name}`, kind: "tour", title: `Take the tour: ${t.tour.title}`, detail: `${t.steps.length} step(s), starting at ${t.first!.symbol}.`, link: { file: t.first!.at!.file, line: t.first!.at!.line, panel: "tours" } })
  for (const term of o.terms.filter((x) => o.exists(x.example.file)).slice(0, 8))
    steps.push({ id: `term:${term.word}`, kind: "term", title: `Learn the term "${term.word}"`, detail: `${term.names} name(s) in the code use it, such as ${term.example.name}.`, link: { file: term.example.file } })
  for (const t of live)
    steps.push({ id: `drills:${t.tour.name}`, kind: "drills", title: `Answer the drills on ${t.tour.title}`, detail: "Questions on where things are and what they do, each with its code.", link: { file: t.first!.at!.file, line: t.first!.at!.line, panel: "tours" } })
  const tasks = o.starter.filter((t) => o.exists(t.file))
  if (tasks.length)
    for (const t of tasks) steps.push({ id: `task:${slug(t.title)}`, kind: "task", title: `Starter task: ${t.title}`, detail: t.note ?? "A first change to make.", link: { file: t.file, ...(t.line ? { line: t.line } : {}) } })
  else steps.push({ id: "task:add-starter-tasks", kind: "task", title: "Add starter tasks for this project", detail: `List first changes to make in ${ONBOARDING_FILE.replace(/\\/g, "/")} (starter: title, file, note), and they appear here.`, link: { file: ONBOARDING_FILE.replace(/\\/g, "/") } })
  return steps
}

type ProgressFile = { projects: Record<string, Record<string, string>> } & Record<string, unknown>

/** Steps done, per project, kept in Codehouse's data folder. */
export class OnboardingProgress {
  readonly #file: string | undefined
  #data: ProgressFile = { projects: {} }

  constructor(file?: string) {
    this.#file = file
    if (file && fs.existsSync(file)) {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as ProgressFile
        if (v && typeof v.projects === "object" && v.projects) this.#data = v
      } catch {
        // Damaged progress starts again; the curriculum itself is made from the project.
      }
    }
  }

  done(project: string): Record<string, string> {
    return { ...(this.#data.projects[project] ?? {}) }
  }

  async mark(project: string, step: string, done: boolean, now = new Date()): Promise<void> {
    const p = (this.#data.projects[project] ??= {})
    if (done) p[step] = now.toISOString()
    else delete p[step]
    if (!this.#file) return
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, JSON.stringify(this.#data, null, 2) + "\n")
  }
}
