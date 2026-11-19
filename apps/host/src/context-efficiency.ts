import fs from "node:fs"
import path from "node:path"
import type { AuditRecord } from "@gatehouse/shared/audit"

/**
 * D-077 (frontier, Insight and evidence): the context efficiency report. What a project tells Claude (its CLAUDE.md,
 * CLAUDE.local.md, AGENTS.md and .claude/CLAUDE.md) is read into every session's context. Each file is split into
 * blocks at its headings, and a block counts as used in a session when a tool call there named something the block
 * names: a command, a path or a name in backticks, or a path written out. The blocks a session never used are listed
 * with their rough size in tokens, and how many of the project's recent sessions used each. A block that names nothing
 * checkable is shown as such rather than guessed at. It reads the files and the audit log only.
 */
export const CONTEXT_FILES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude/CLAUDE.md"]

export interface Block {
  file: string
  heading: string
  line: number
  tokens: number
  /** What it names that a tool call could use. Empty: it cannot be checked. */
  terms: string[]
}

export interface BlockUse extends Block {
  /** In the session asked about; undefined when the block names nothing to check. */
  used?: boolean
  /** How many of the project's recent sessions used it, of how many. */
  sessionsUsing: number
  sessions: number
}

export interface ContextReport {
  blocks: BlockUse[]
  unusedTokens: number
  totalTokens: number
}

const tokensOf = (text: string) => Math.ceil(text.length / 4)
const PATHLIKE = /(?:^|[\s(])((?:\.{0,2}\/)?[\w@.-]+\/[\w@./*-]+|[\w-]+\.(?:ts|tsx|js|mjs|json|md|ps1|cs|py|ya?ml|toml|sh|css))(?=$|[\s),.;:])/g

/** The checkable things a block names. Short or generic spans are left out. */
export function termsOf(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(/`([^`\n]{3,120})`/g)) {
    const t = m[1]!.trim().toLowerCase()
    if (/^(true|false|null|undefined|yes|no)$/.test(t)) continue
    out.add(t.length > 48 ? t.slice(0, 48) : t)
  }
  const plain = body.replace(/`[^`\n]*`/g, " ")
  for (const m of plain.matchAll(PATHLIKE)) {
    const t = m[1]!.toLowerCase().replace(/^\.\//, "").replace(/\*+.*$/, "").replace(/[.,;:]+$/, "")
    if (t.length >= 4 && !/^https?:/.test(t) && !t.includes("//")) out.add(t.replace(/\/$/, ""))
  }
  return [...out]
}

/** A file's blocks: each heading and what follows it up to the next heading; the text before the first is one too. */
export function blocksOf(file: string, text: string): Block[] {
  const lines = text.split(/\r?\n/)
  const blocks: Block[] = []
  let start = 0
  let heading = "(before the first heading)"
  const close = (end: number) => {
    const body = lines.slice(start, end).join("\n")
    if (body.trim()) blocks.push({ file, heading, line: start + 1, tokens: tokensOf(body), terms: termsOf(body) })
  }
  let fenced = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fenced = !fenced
    if (fenced || !/^#{1,4}\s+\S/.test(l)) return
    close(i)
    start = i
    heading = l.replace(/^#+\s+/, "").trim().slice(0, 120)
  })
  close(lines.length)
  return blocks
}

/** The project's instruction blocks, from the files that exist at its root. */
export function projectBlocks(root: string): Block[] {
  const out: Block[] = []
  for (const f of CONTEXT_FILES)
    try {
      const abs = path.join(root, f)
      if (fs.statSync(abs).size <= 1_000_000) out.push(...blocksOf(f, fs.readFileSync(abs, "utf8")))
    } catch {
      // not there
    }
  return out
}

/** What a session's tool calls named, lower-cased, with path separators as forward slashes. */
const textOf = (records: Array<Pick<AuditRecord, "inputJson">>) =>
  records
    .map((r) => r.inputJson ?? "")
    .join("\n")
    .replace(/\\\\/g, "/")
    .toLowerCase()

/** The report for one session, with the project's recent sessions (session id to its records) for the counts. */
export function contextReport(blocks: Block[], session: Array<Pick<AuditRecord, "inputJson">>, recent: Map<string, Array<Pick<AuditRecord, "inputJson">>>): ContextReport {
  const mine = textOf(session)
  const others = [...recent.values()].map(textOf)
  const uses = (text: string, b: Block) => b.terms.some((t) => text.includes(t))
  const out: BlockUse[] = blocks.map((b) => ({
    ...b,
    ...(b.terms.length ? { used: uses(mine, b) } : {}),
    sessionsUsing: b.terms.length ? others.filter((t) => uses(t, b)).length : 0,
    sessions: others.length,
  }))
  return {
    blocks: out,
    unusedTokens: out.filter((b) => b.used === false).reduce((a, b) => a + b.tokens, 0),
    totalTokens: out.reduce((a, b) => a + b.tokens, 0),
  }
}
