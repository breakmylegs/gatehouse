import type { Verdict } from "@gatehouse/shared"

/**
 * B32: provenance against prompt injection. What a session read from outside (web pages, web searches, servers that are
 * not Codehouse's own) is remembered for a while; a later shell command that appears word for word in it may have been
 * planted there, so it goes to a person, whatever the rules or Extreme approval would do with it.
 */
export const TAINT_RULE = "untrusted-content"

const SHELL = new Set(["Bash", "PowerShell"])
const MAX_TEXTS = 40
const MAX_TEXT = 200_000
/** Short commands (ls, git status) appear in every page about them; only longer ones are worth flagging. */
const MIN_COMMAND = 16

/** Whether a tool's result comes from outside this computer's own tools. */
export const fromOutside = (tool: string): boolean =>
  tool === "WebFetch" ||
  tool === "WebSearch" ||
  (tool.startsWith("mcp__") && !tool.startsWith("mcp__companion__"))

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase()

/**
 * D-015: files whose words are not the project's own, read in a session: documentation and the code of others. What
 * they say can be written to talk a person into a broad allow, so a rule they mention is not remembered. Settings,
 * Sessions can change the list (untrustedFiles).
 */
export const UNTRUSTED_FILES: readonly string[] = [
  "**/readme*",
  "**/*.md",
  "**/node_modules/**",
  "**/vendor/**",
  "**/third_party/**",
]

/** A rule about to be remembered: its command, its file, or its site. */
export interface RuleTerms {
  command?: string
  path?: string
  host?: string
}

export class Provenance {
  readonly #texts: string[] = []
  /** D-015: untrusted files read in the session, kept apart: they do not taint commands, only remembering. */
  readonly #files: string[] = []

  /** D-015: an untrusted file the session read. */
  addUntrustedFile(result: unknown): void {
    let text: string
    try {
      text = typeof result === "string" ? result : JSON.stringify(result)
    } catch {
      return
    }
    if (!text) return
    this.#files.push(norm(text.slice(0, MAX_TEXT)))
    if (this.#files.length > MAX_TEXTS) this.#files.shift()
  }

  /**
   * D-015: why a rule must not be remembered, or undefined: what the session read from outside, or an untrusted file,
   * mentions its command, its file (by name, or its path from the folder) or its site.
   */
  mentions(rule: RuleTerms, cwd: string): string | undefined {
    const terms: string[] = []
    if (rule.command && norm(rule.command).length >= 8) terms.push(norm(rule.command))
    if (rule.host && rule.host.length >= 4) terms.push(rule.host.toLowerCase())
    if (rule.path) {
      const p = rule.path.replace(/\\/g, "/")
      const base = p.split("/").at(-1) ?? ""
      if (base.length >= 5) terms.push(base.toLowerCase())
      const c = cwd.replace(/\\/g, "/").toLowerCase()
      if (p.toLowerCase().startsWith(c + "/")) terms.push(p.slice(c.length + 1).toLowerCase())
    }
    const hit = terms.find((t) => [...this.#texts, ...this.#files].some((x) => x.includes(t)))
    return hit
      ? `What Claude read in this session from outside, or in a file that is not the project's own words (such as a README), mentions "${hit}", so it may have been written to get this allowed. It is allowed this once, not remembered.`
      : undefined
  }

  /** Something a session read from outside. The newest are kept. */
  add(result: unknown): void {
    let text: string
    try {
      text = typeof result === "string" ? result : JSON.stringify(result)
    } catch {
      return
    }
    if (!text) return
    this.#texts.push(norm(text.slice(0, MAX_TEXT)))
    if (this.#texts.length > MAX_TEXTS) this.#texts.shift()
  }

  /** Why a call looks copied from what was read, or undefined. Only shell commands, of some length. */
  taint(tool: string, input: Record<string, unknown>): string | undefined {
    if (!SHELL.has(tool) || typeof input.command !== "string") return undefined
    const cmd = norm(input.command)
    if (cmd.length < MIN_COMMAND) return undefined
    return this.#texts.some((t) => t.includes(cmd))
      ? "This command appears word for word in a web page or tool result Claude read in this session, so it may have been planted there. Check it is what you want before it runs."
      : undefined
  }
}

/**
 * A verdict with the taint applied: an allow or an escalation becomes an escalation under TAINT_RULE (which Extreme
 * approval never answers by itself), at a higher risk. A deny stays a deny. No taint: the verdict as it was.
 */
export function withProvenance(
  verdict: Verdict,
  tool: string,
  input: Record<string, unknown>,
  provenance: Provenance | undefined,
): Verdict {
  if (!provenance || verdict.outcome === "deny") return verdict
  const why = provenance.taint(tool, input)
  if (!why) return verdict
  return {
    ...verdict,
    outcome: "escalate",
    ruleId: TAINT_RULE,
    reason: `${why} (${verdict.outcome === "allow" ? "allowed" : "held"} by rule ${verdict.ruleId} otherwise.)`,
    risk: Math.min(100, Math.max(70, verdict.risk + 20)),
  }
}
