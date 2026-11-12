/**
 * D-038 and D-044 (Frontier build, Wave 3): architecture decision records.
 *
 * D-038: a decision made in a session (a question you answered, a plan you approved) is drafted as an ADR in MADR
 * format, with a link back to the session and its audit record; you read and edit it, and only when you accept it is it
 * written to the project's docs/adr, by the Host, recorded as adr_written.
 *
 * D-044: the project's accepted ADRs are given to each session with its instructions (those whose paths match the
 * change first), and an edit that adds what an ADR forbids (front matter forbids: words, imports or calls, optionally
 * only under paths:) goes to a person, with the ADR named.
 */
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { compileGlobs } from "@gatehouse/policy"
import type { AuditRecord } from "@gatehouse/shared/audit"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { afterEdit } from "./architecture.js"

export const ADR_DIR = path.join("docs", "adr")
export const ADR_RULE = "adr-contradiction"

export interface Decision {
  seq: number
  kind: "question" | "plan"
  title: string
  context: string
  options: string[]
  chosen: string
  why?: string
}

function inputOf(r: AuditRecord): Record<string, unknown> {
  try {
    const v = JSON.parse(r.inputJson) as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The decisions a session made that could become ADRs: each question answered, and the plans approved. */
export function decisionsIn(records: AuditRecord[]): Decision[] {
  const out: Decision[] = []
  for (const r of records) {
    if (r.verdict.outcome !== "allow") continue
    const input = inputOf(r)
    if (r.event === "question_answered" && Array.isArray(input.questions)) {
      const answers = (input.answers && typeof input.answers === "object" ? input.answers : {}) as Record<string, string>
      for (const q of input.questions as Array<Record<string, unknown>>) {
        const question = String(q.question ?? "").trim()
        const chosen = answers[question]
        if (!question || !chosen) continue
        const options = (Array.isArray(q.options) ? q.options : []).map((o) => {
          const x = o as Record<string, unknown>
          return `${String(x.label ?? "")}${x.description ? `: ${String(x.description)}` : ""}`
        })
        const why = (Array.isArray(q.options) ? q.options : []).map((o) => o as Record<string, unknown>).find((o) => o.label === chosen)?.description
        out.push({
          seq: r.seq,
          kind: "question",
          title: String(q.header ?? question).slice(0, 80),
          context: question,
          options,
          chosen,
          ...(typeof why === "string" ? { why } : {}),
        })
      }
    } else if (r.event === "plan_decision" && typeof input.plan === "string") {
      const plan = input.plan.trim()
      const heading = /^#+\s+(.+)$/m.exec(plan)?.[1]?.trim()
      out.push({ seq: r.seq, kind: "plan", title: heading ?? plan.split(/\r?\n/)[0]!.slice(0, 80), context: plan.slice(0, 3000), options: [], chosen: "the approved plan" })
    }
  }
  return out
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "decision"

/** The next ADR number in the project's docs/adr. */
export function nextNumber(root: string): number {
  try {
    const nums = fs.readdirSync(path.join(root, ADR_DIR)).map((f) => Number(/^(\d{4})-/.exec(f)?.[1] ?? 0))
    return Math.max(0, ...nums) + 1
  } catch {
    return 1
  }
}

/** A decision as a MADR draft, linking back to the session and the record it came from. */
export function draftAdr(d: Decision, o: { number: number; session: string; date: string }): { file: string; text: string } {
  const n = String(o.number).padStart(4, "0")
  const text = [
    "---",
    "status: proposed",
    `date: ${o.date}`,
    `session: ${o.session}`,
    `record: ${d.seq}`,
    "---",
    "",
    `# ${n}. ${d.title}`,
    "",
    "## Context and Problem Statement",
    "",
    d.kind === "plan" ? "A plan was approved in a Codehouse session:" : d.context,
    ...(d.kind === "plan" ? ["", ...d.context.split(/\r?\n/).map((l) => `> ${l}`)] : []),
    "",
    ...(d.options.length ? ["## Considered Options", "", ...d.options.map((x) => `* ${x}`), ""] : []),
    "## Decision Outcome",
    "",
    `Chosen option: "${d.chosen}"${d.why ? `, because ${d.why.replace(/\.$/, "")}` : ""}.`,
    "",
    "## More Information",
    "",
    `Decided in Codehouse session ${o.session} (audit record ${d.seq}). Open the session's Timeline to see the decision as it was made.`,
    "",
  ].join("\n")
  return { file: path.join(ADR_DIR, `${n}-${slug(d.title)}.md`).replace(/\\/g, "/"), text }
}

/** Writes an accepted ADR into the project. Refuses a path outside docs/adr or one that is already there. */
export async function writeAdr(root: string, file: string, text: string): Promise<string> {
  const rel = file.replace(/\\/g, "/")
  if (!/^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/.test(rel)) throw new Error("An ADR is written only as docs/adr/NNNN-name.md.")
  const abs = path.join(root, rel)
  if (fs.existsSync(abs)) throw new Error(`${rel} is already there.`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  await writeFileAtomic(abs, text.endsWith("\n") ? text : `${text}\n`)
  return rel
}

export interface Adr {
  file: string
  title: string
  status: string
  outcome?: string
  forbids: string[]
  paths?: (file: string) => boolean
  pathGlobs: string[]
}

/** The project's ADRs, read tolerantly: front matter if there is one, the title and the decision outcome. */
export function readAdrs(root: string): Adr[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(path.join(root, ADR_DIR)).filter((n) => n.toLowerCase().endsWith(".md")).sort()
  } catch {
    return []
  }
  const out: Adr[] = []
  for (const n of names) {
    let text: string
    try {
      text = fs.readFileSync(path.join(root, ADR_DIR, n), "utf8")
    } catch {
      continue
    }
    let meta: Record<string, unknown> = {}
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (fm)
      try {
        meta = (parseYaml(fm[1]!) as Record<string, unknown>) ?? {}
      } catch {
        meta = {}
      }
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [])
    const status = String(meta.status ?? /^\*\s*Status:\s*(\w+)/im.exec(text)?.[1] ?? "accepted").toLowerCase()
    const pathGlobs = list(meta.paths)
    out.push({
      file: `${ADR_DIR}/${n}`.replace(/\\/g, "/"),
      title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? n,
      status,
      ...(/^Chosen option:\s*(.+)$/m.exec(text)?.[1] ? { outcome: /^Chosen option:\s*(.+)$/m.exec(text)![1]!.trim() } : {}),
      forbids: list(meta.forbids),
      pathGlobs,
      ...(pathGlobs.length ? { paths: compileGlobs(pathGlobs.map((g) => g.toLowerCase())) } : {}),
    })
  }
  return out
}

const LIVE = (a: Adr) => !["superseded", "deprecated", "rejected", "proposed"].includes(a.status)

/** D-044: the ADRs for a session's instructions: those whose paths match the files in hand first, at most `max` characters. */
export function adrContext(adrs: Adr[], touched: string[], max = 4000): string {
  const live = adrs.filter(LIVE)
  if (!live.length) return ""
  const matches = (a: Adr) => (a.paths ? touched.some((f) => a.paths!(f.replace(/\\/g, "/").toLowerCase())) : false)
  const ordered = [...live.filter(matches), ...live.filter((a) => !matches(a))]
  const lines: string[] = []
  let room = max
  for (const a of ordered) {
    const line = `- ${a.title}${a.outcome ? `: ${a.outcome}` : ""} (${a.file})${a.forbids.length ? `; it rules out ${a.forbids.join(", ")}` : ""}`
    if (line.length > room) break
    lines.push(line)
    room -= line.length + 1
  }
  return lines.length ? `The project's architecture decisions (keep to them; if one must change, say so instead of working around it):\n${lines.join("\n")}` : ""
}

/** D-044: what an edit adds that an accepted ADR forbids, by the ADR. */
export function adrContradictions(root: string, adrs: Adr[], tool: string, input: Record<string, unknown>): Array<{ adr: Adr; word: string }> {
  if (!["Write", "Edit", "MultiEdit"].includes(tool)) return []
  const abs = String(input.file_path ?? "")
  const rel = path.relative(root, abs).replace(/\\/g, "/")
  if (!rel || rel.startsWith("..")) return []
  let current: string | undefined
  try {
    current = fs.readFileSync(abs, "utf8")
  } catch {
    current = undefined
  }
  const next = afterEdit(tool, input, current)
  if (next === undefined) return []
  const out: Array<{ adr: Adr; word: string }> = []
  for (const a of adrs.filter(LIVE)) {
    if (a.paths && !a.paths(rel.toLowerCase())) continue
    for (const w of a.forbids) {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
      if (re.test(next) && !(current !== undefined && re.test(current))) out.push({ adr: a, word: w })
    }
  }
  return out
}

export const adrReason = (found: Array<{ adr: Adr; word: string }>) =>
  `This edit goes against the project's architecture decisions: ${found
    .slice(0, 3)
    .map((f) => `${f.adr.title} (${f.adr.file}) rules out ${f.word}`)
    .join("; ")}. If the decision should change, change the ADR first.`
