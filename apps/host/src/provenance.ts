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

export class Provenance {
  readonly #texts: string[] = []

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
