/**
 * D-033, D-034 and D-035 (Frontier build, Wave 3): what was asked for, and whether the change keeps to it.
 *
 * The requirement ledger (D-033) is the project's own docs\requirements folder: one Markdown file per requirement, with
 * front matter (id, title, and optionally tests, files and status) and the words; EARS wording is welcome, not needed.
 * Files are read tolerantly: one without front matter takes its id from its name or its first heading, and is listed
 * with what was wrong. Each requirement is linked to the commits whose message names its id, the test files that name
 * it or that it lists, and the evidence packs of those commits; every link is checked, and a requirement with no test,
 * or a link to a file that is not there, is a gap.
 *
 * D-034 flags each hunk of the change that neither the approved plan nor any requirement accounts for, with the reason.
 * D-035 counts the files the session changed that the plan did not name: the scope creep meter on the progress card.
 */
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import type { AuditRecord } from "@gatehouse/shared/audit"

export interface Requirement {
  id: string
  title: string
  file: string
  status?: string
  /** Test files the requirement names in its front matter. */
  tests: string[]
  /** Files the requirement says it concerns. */
  files: string[]
  body: string
}

export interface LedgerProblem {
  file: string
  problem: string
}

export interface TraceRow {
  id: string
  title: string
  file: string
  status?: string
  commits: string[]
  tests: string[]
  evidence: string[]
  gaps: string[]
}

export const REQUIREMENTS_DIR = path.join("docs", "requirements")

const ID = /\b(REQ-[A-Za-z0-9][A-Za-z0-9._-]*)\b/

/** The requirements in the project, and what could not be read cleanly. Never throws. */
export function readRequirements(root: string): { requirements: Requirement[]; problems: LedgerProblem[] } {
  const dir = path.join(root, REQUIREMENTS_DIR)
  const requirements: Requirement[] = []
  const problems: LedgerProblem[] = []
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md")).sort()
  } catch {
    return { requirements, problems }
  }
  const seen = new Set<string>()
  for (const name of names) {
    const rel = path.join(REQUIREMENTS_DIR, name).replace(/\\/g, "/")
    let text: string
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8").replace(/^﻿/, "")
    } catch {
      problems.push({ file: rel, problem: "it could not be read" })
      continue
    }
    let meta: Record<string, unknown> = {}
    let body = text
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
    if (fm) {
      body = text.slice(fm[0].length)
      try {
        const y = parseYaml(fm[1]!) as unknown
        if (y && typeof y === "object" && !Array.isArray(y)) meta = y as Record<string, unknown>
        else problems.push({ file: rel, problem: "its front matter is not a set of fields" })
      } catch {
        problems.push({ file: rel, problem: "its front matter is not valid YAML, so only its words were read" })
      }
    } else problems.push({ file: rel, problem: "it has no front matter, so its id was taken from its name or heading" })
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
    const id = (typeof meta.id === "string" && meta.id.trim()) || ID.exec(name)?.[1] || ID.exec(heading ?? "")?.[1]
    if (!id) {
      problems.push({ file: rel, problem: "it has no id (an id field, or REQ- in its name or heading)" })
      continue
    }
    if (seen.has(id)) {
      problems.push({ file: rel, problem: `its id ${id} is used by another requirement` })
      continue
    }
    seen.add(id)
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [])
    requirements.push({
      id,
      title: (typeof meta.title === "string" && meta.title) || heading?.replace(ID, "").replace(/^[\s:-]+/, "") || id,
      file: rel,
      ...(typeof meta.status === "string" ? { status: meta.status } : {}),
      tests: list(meta.tests),
      files: list(meta.files),
      body: body.trim(),
    })
  }
  return { requirements, problems }
}

/**
 * The trace matrix: each requirement with its commits, tests and evidence packs, and its gaps. `commitsFor` gives the
 * commits whose message names an id; `testFiles` are the project's test files; `evidenceFor` the packs of a commit.
 */
export function traceMatrix(o: {
  root: string
  requirements: Requirement[]
  commitsFor: (id: string) => string[]
  testFiles: string[]
  evidenceFor: (commit: string) => string[]
}): TraceRow[] {
  const texts = new Map<string, string>()
  const textOf = (f: string) => {
    if (!texts.has(f)) {
      try {
        texts.set(f, fs.readFileSync(path.join(o.root, f), "utf8"))
      } catch {
        texts.set(f, "")
      }
    }
    return texts.get(f)!
  }
  return o.requirements.map((r) => {
    const gaps: string[] = []
    const named = o.testFiles.filter((t) => textOf(t).includes(r.id))
    for (const t of r.tests) if (!fs.existsSync(path.join(o.root, t))) gaps.push(`it names the test file ${t}, which is not there`)
    for (const f of r.files) if (!fs.existsSync(path.join(o.root, f))) gaps.push(`it names the file ${f}, which is not there`)
    const tests = [...new Set([...r.tests.filter((t) => fs.existsSync(path.join(o.root, t))), ...named])]
    if (!tests.length) gaps.push("no test names it, and it names none")
    const commits = o.commitsFor(r.id)
    const evidence = [...new Set(commits.flatMap((c) => o.evidenceFor(c)))]
    return { id: r.id, title: r.title, file: r.file, ...(r.status ? { status: r.status } : {}), commits, tests, evidence, gaps }
  })
}

/** The plan the session's approved ExitPlanMode held, from the audit log: the newest one allowed. */
export function approvedPlan(records: AuditRecord[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]!
    if (r.tool !== "ExitPlanMode" || r.verdict.outcome !== "allow") continue
    try {
      const plan = (JSON.parse(r.inputJson) as { plan?: unknown }).plan
      if (typeof plan === "string" && plan.trim()) return plan
    } catch {
      // keep looking
    }
  }
  return undefined
}

/** The file paths a text names: anything that looks like a path with an extension, in backticks or not. */
export function filesIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?:^|[\s`'"(\[])((?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,5})(?=$|[\s`'"),.:;\]])/gm)) {
    const p = m[1]!.replace(/\\/g, "/").replace(/^\.\//, "")
    if (!/^\d+(\.\d+)+$/.test(p) && !/^(e\.g|i\.e)\.?$/i.test(p)) out.add(p)
  }
  return [...out]
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
const mentions = (paths: string[], file: string) => {
  const f = norm(file)
  return paths.some((p) => {
    const q = norm(p)
    return q === f || f.endsWith(`/${q}`) || q.endsWith(`/${f}`)
  })
}

/** D-035: the files the session changed that the plan did not name. Without a plan, nothing is outside it. */
export function scopeOf(plan: string | undefined, changed: string[]): { planned: string[]; outside: string[] } {
  if (!plan) return { planned: [], outside: [] }
  const planned = filesIn(plan)
  return { planned, outside: changed.filter((f) => !mentions(planned, f)) }
}

export interface Unrequested {
  file: string
  hunk: number
  reason: string
}

/** The names a hunk adds: functions, classes, exports and routes, which a plan or a requirement would mention. */
function namesIn(lines: string[]): string[] {
  const out = new Set<string>()
  for (const l of lines) {
    for (const m of l.matchAll(/\b(?:function|class|interface|type|const|let|def|export\s+(?:const|function|class))\s+([A-Za-z_$][\w$]{2,})/g)) out.add(m[1]!)
    for (const m of l.matchAll(/["'`](\/[\w/:-]{2,})["'`]/g)) out.add(m[1]!)
  }
  return [...out]
}

/**
 * D-034: the hunks neither the plan nor a requirement accounts for. A hunk is accounted for when its file is named by
 * the plan or a requirement, or a name it adds is mentioned in either. Without a plan and with no requirements there is
 * nothing to trace against, and nothing is flagged.
 */
export function unrequested(o: {
  plan: string | undefined
  requirements: Requirement[]
  files: Array<{ path: string; diff: string }>
}): Unrequested[] {
  if (!o.plan && !o.requirements.length) return []
  const words = [o.plan ?? "", ...o.requirements.map((r) => `${r.title}\n${r.body}`)].join("\n")
  const named = [...filesIn(words), ...o.requirements.flatMap((r) => [...r.files, ...r.tests])]
  const out: Unrequested[] = []
  for (const f of o.files) {
    if (mentions(named, f.path)) continue
    let hunk = -1
    let added: string[] = []
    const flush = () => {
      if (hunk < 0 || !added.some((l) => l.trim())) return
      const names = namesIn(added)
      if (names.some((n) => words.includes(n))) return
      out.push({
        file: f.path,
        hunk,
        reason: names.length
          ? `Neither the plan nor a requirement names ${f.path} or what it adds (${names.slice(0, 3).join(", ")}).`
          : `Neither the plan nor a requirement names ${f.path}.`,
      })
    }
    for (const line of f.diff.split(/\r?\n/)) {
      if (line.startsWith("@@")) {
        flush()
        hunk++
        added = []
      } else if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1))
    }
    flush()
  }
  return out
}
