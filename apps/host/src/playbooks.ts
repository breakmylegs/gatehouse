/**
 * E-053, verified playbooks (Expansion E4). A project keeps playbooks in .codehouse/playbooks (YAML): the steps of a
 * kind of work, and a checklist for its end. Each checklist item can carry an automatic check: files matching a glob
 * changed, a file exists, the change contains some text, or a command passes (run as a Codehouse action). Starting a
 * playbook gives the session its steps and checklist; at the end Codehouse verifies the checklist against the real
 * change, and lists every item that is unmet, and those only a person can check.
 *
 *   name: Add an API endpoint
 *   steps: [Write the handler, Add tests, Update the API docs]
 *   checklist:
 *     - { text: Tests added, changed: "**\/*.test.ts" }
 *     - { text: API docs updated, changed: "docs/api/**" }
 *     - { text: Lint passes, run: "npm run lint" }
 *     - { text: Reviewed by a person }
 */
import fs from "node:fs"
import path from "node:path"
import { compileGlobs, parseYaml } from "@gatehouse/policy"

export interface ChecklistItem {
  text: string
  /** Files matching this glob must have changed. */
  changed?: string
  /** This file must exist. */
  exists?: string
  /** The change must contain this text (in changed files). */
  contains?: string
  /** This command must pass. */
  run?: string
}

export interface Playbook {
  id: string
  name: string
  steps: string[]
  checklist: ChecklistItem[]
}

const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined)

/** The project's playbooks; a file that does not read as one is left out. */
export function readPlaybooks(root: string): Playbook[] {
  const dir = path.join(root, ".codehouse", "playbooks")
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).slice(0, 50)
  } catch {
    return []
  }
  const out: Playbook[] = []
  for (const f of files)
    try {
      const v = parseYaml(fs.readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>
      const name = str(v?.name, 120)
      if (!name) continue
      const steps = (Array.isArray(v.steps) ? v.steps : []).map((s) => (typeof s === "string" ? s : str((s as Record<string, unknown>)?.title, 300))).filter((s): s is string => !!s).slice(0, 30)
      const checklist = (Array.isArray(v.checklist) ? v.checklist : [])
        .map((c): ChecklistItem | undefined => {
          if (typeof c === "string") return { text: c.slice(0, 300) }
          const o = c as Record<string, unknown>
          const text = str(o?.text, 300)
          if (!text) return undefined
          return { text, ...(str(o.changed, 300) ? { changed: str(o.changed, 300)! } : {}), ...(str(o.exists, 300) ? { exists: str(o.exists, 300)! } : {}), ...(str(o.contains, 300) ? { contains: str(o.contains, 300)! } : {}), ...(str(o.run, 2000) ? { run: str(o.run, 2000)! } : {}) }
        })
        .filter((c): c is ChecklistItem => !!c)
        .slice(0, 40)
      out.push({ id: f.replace(/\.ya?ml$/i, ""), name, steps, checklist })
    } catch {
      // Not YAML: left out.
    }
  return out
}

/** What the session is told when a playbook starts. */
export function playbookPrompt(p: Playbook): string {
  return [
    `Follow the playbook "${p.name}" for this work.`,
    p.steps.length ? `Steps:\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    p.checklist.length ? `Codehouse will check this at the end:\n${p.checklist.map((c) => `- ${c.text}`).join("\n")}` : "",
    "Do every step; when you are done, say which steps you did and how.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

export interface ItemResult {
  text: string
  status: "met" | "unmet" | "person"
  why: string
}

export interface VerifyDeps {
  /** The files the change touches, relative with forward slashes, lower case. */
  changed: Set<string>
  run: (command: string, cwd: string) => Promise<{ ran: boolean; exitCode: number | null; refused?: string }>
}

/** Each checklist item checked against the change: met, unmet (and why), or one only a person can check. */
export async function verifyPlaybook(root: string, p: Playbook, d: VerifyDeps): Promise<ItemResult[]> {
  const out: ItemResult[] = []
  for (const c of p.checklist) {
    const fails: string[] = []
    let automatic = false
    if (c.changed) {
      automatic = true
      const match = compileGlobs([c.changed.toLowerCase()])
      if (![...d.changed].some((f) => match(f))) fails.push(`nothing matching ${c.changed} changed`)
    }
    if (c.exists) {
      automatic = true
      const abs = path.resolve(root, c.exists)
      if (path.relative(root, abs).startsWith("..") || !fs.existsSync(abs)) fails.push(`${c.exists} is not there`)
    }
    if (c.contains) {
      automatic = true
      const hit = [...d.changed].some((f) => {
        try {
          return fs.readFileSync(path.join(root, f), "utf8").includes(c.contains!)
        } catch {
          return false
        }
      })
      if (!hit) fails.push(`no changed file contains "${c.contains}"`)
    }
    if (c.run) {
      automatic = true
      const r = await d.run(c.run, root)
      if (!r.ran) fails.push(`${c.run} was not run (${r.refused ?? "refused"})`)
      else if (r.exitCode !== 0) fails.push(`${c.run} failed (exit ${r.exitCode})`)
    }
    out.push(!automatic ? { text: c.text, status: "person", why: "only a person can check this" } : fails.length ? { text: c.text, status: "unmet", why: fails.join("; ") } : { text: c.text, status: "met", why: "checked" })
  }
  return out
}
