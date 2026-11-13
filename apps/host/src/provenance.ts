import type { Verdict } from "@gatehouse/shared"

/**
 * B32: provenance against prompt injection. What a session read from outside (web pages, web searches, servers that are
 * not Codehouse's own) is remembered for a while; a later shell command that appears word for word in it may have been
 * planted there, so it goes to a person, whatever the rules or Extreme approval would do with it.
 */
export const TAINT_RULE = "untrusted-content"
/** D-016: a network call, or a write outside the project, carrying a value from an untrusted source. */
export const EGRESS_RULE = "tainted-egress"
/**
 * Owner, 13 Nov ("Web fetch should just be allowed on extreme approval mode"): a WebFetch whose address carries such a
 * value, or any WebFetch after a result that looked like prompt injection (D-061). It still asks in Manual, but Extreme
 * approval answers it and a session's WebFetch grant allows it. Network commands stay under EGRESS_RULE.
 */
export const FETCH_RULE = "tainted-fetch"

/** Owner, 13 Nov: the tools a session may be granted from the desktop card, so each call no longer asks. */
export const GRANTABLE_TOOLS: ReadonlySet<string> = new Set(["WebFetch", "WebSearch"])

/** D-016: network-capable shell commands: the ones that can send what they are given somewhere. */
const NETWORK = /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|start-bitstransfer|scp|sftp|ftp|rsync|ssh|nc|ncat|telnet|npm\s+publish|pnpm\s+publish|yarn\s+publish|twine\s+upload|dotnet\s+nuget\s+push|nuget\s+push|gh\s+release\s+upload|git\s+push|git\s+remote\s+(add|set-url))\b/i
/** Addresses on this computer are not somewhere else. */
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i
const MAX_VALUES = 3000

/** The values worth following out of a text: addresses, their hosts, email addresses, long tokens. */
export function valuesIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s"'<>`)\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, "")
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (LOCAL_HOST.test(host)) continue
      out.add(url.toLowerCase())
      if (host.includes(".")) out.add(host)
    } catch {
      // not an address after all
    }
  }
  for (const m of text.matchAll(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g)) out.add(m[0].toLowerCase())
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{32,}/g)) out.add(m[0])
  return [...out]
}

/** An address as compared for D-016: lower case, without its fragment, trailing punctuation or a trailing slash. */
export function sameAddress(url: string): string | undefined {
  try {
    const u = new URL(url.trim().replace(/[.,;:!?]+$/, ""))
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined
    u.hash = ""
    return u.toString().toLowerCase().replace(/\/$/, "")
  } catch {
    return undefined
  }
}

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
  /** D-016: each value from an untrusted source, and where it came from. */
  readonly #values = new Map<string, string>()
  /** D-017: how many untrusted reads there have been, and that count when each subagent started, by its tool use id. */
  #reads = 0
  readonly #subagents = new Map<string, number>()
  /** D-061: why the session's taint was raised (a result that looked like prompt injection), if it was. */
  #raised: string | undefined

  /** D-061: a result held what looks like prompt injection: from now on every network call asks. */
  raise(why: string): void {
    this.#raised ??= why
  }

  /** D-061: whether a result looked like prompt injection in this session. */
  isRaised(): boolean {
    return this.#raised !== undefined
  }

  /** D-017: a subagent (the Task or Agent tool) is starting. */
  subagentStarted(toolUseId: string): void {
    this.#subagents.set(toolUseId, this.#reads)
    if (this.#subagents.size > 200) this.#subagents.delete(this.#subagents.keys().next().value as string)
  }

  /**
   * D-017: a subagent finished. If anything untrusted was read while it ran (it reads through the same hooks), what it
   * reports carries that taint too: its words count as read from outside, and its values keep that as their source.
   */
  subagentFinished(toolUseId: string, result: unknown): void {
    const since = this.#subagents.get(toolUseId)
    this.#subagents.delete(toolUseId)
    if (since === undefined || this.#reads === since) return
    this.add(result, "the report of a subagent that read untrusted content")
  }

  #remember(text: string, source: string): void {
    for (const v of valuesIn(text)) {
      if (this.#values.has(v)) continue
      this.#values.set(v, source)
      if (this.#values.size > MAX_VALUES) this.#values.delete(this.#values.keys().next().value as string)
    }
  }
  /** D-015: untrusted files read in the session, kept apart: they do not taint commands, only remembering. */
  readonly #files: string[] = []

  /** D-015: an untrusted file the session read. */
  addUntrustedFile(result: unknown, file?: string): void {
    let text: string
    try {
      text = typeof result === "string" ? result : JSON.stringify(result)
    } catch {
      return
    }
    if (!text) return
    this.#reads++
    this.#remember(text.slice(0, MAX_TEXT), file ? `the file ${file}` : "a file that is not the project's own words")
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
  add(result: unknown, source?: string): void {
    let text: string
    try {
      text = typeof result === "string" ? result : JSON.stringify(result)
    } catch {
      return
    }
    if (!text) return
    this.#reads++
    this.#remember(text.slice(0, MAX_TEXT), source ?? "something read from outside")
    this.#texts.push(norm(text.slice(0, MAX_TEXT)))
    if (this.#texts.length > MAX_TEXTS) this.#texts.shift()
  }

  /**
   * D-016: why a call sends on a value from an untrusted source, or undefined: a network-capable command or WebFetch
   * whose arguments carry one, or a write outside the project whose content does. The reason names the value and where
   * it came from.
   */
  egress(tool: string, input: Record<string, unknown>, cwd: string | undefined): string | undefined {
    // D-061: after a result that looked like prompt injection, any network call asks, whatever it carries.
    if (this.#raised && ((SHELL.has(tool) && typeof input.command === "string" && NETWORK.test(input.command)) || tool === "WebFetch"))
      return `This is a network call after ${this.#raised}, so it is yours to decide.`
    if (!this.#values.size) return undefined
    let carried = ""
    let what = ""
    if (SHELL.has(tool) && typeof input.command === "string" && NETWORK.test(input.command)) {
      carried = input.command
      what = "This network command carries"
    } else if (tool === "WebFetch" && typeof input.url === "string") {
      // Owner, 12 Nov: a session researching from search results was held on every page it fetched. A fetch of an
      // address exactly as it was read (fragment and a trailing slash aside) carries nothing from the session: what
      // D-016 guards against is an address with something added, a path, a query or a value, which this still holds.
      // It then goes to the network rule as any fetch does.
      if (this.#readAsIs(input.url)) return undefined
      carried = input.url
      what = "This fetch goes to"
    } else if (["Write", "Edit", "MultiEdit"].includes(tool) && typeof input.file_path === "string" && cwd) {
      const p = input.file_path.replace(/\\/g, "/").toLowerCase()
      const root = cwd.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "")
      if (p.startsWith(root + "/")) return undefined
      carried = JSON.stringify(input)
      what = "This write outside the project carries"
    } else return undefined
    const low = carried.toLowerCase()
    for (const [v, source] of this.#values) {
      const hit = /[A-Z]/.test(v) ? carried.includes(v) : low.includes(v)
      if (hit)
        return `${what} ${v.length > 80 ? `${v.slice(0, 77)}...` : v}, which came from ${source}, read in this session. Where a value came from can be written to send your work somewhere else, so this is yours to decide.`
    }
    return undefined
  }

  /** Whether an address is one read from outside exactly as it is, not only its host. */
  #readAsIs(url: string): boolean {
    const key = sameAddress(url)
    if (!key) return false
    for (const v of this.#values.keys()) if (/^https?:\/\//.test(v) && sameAddress(v) === key) return true
    return false
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
  cwd?: string,
): Verdict {
  if (!provenance || verdict.outcome === "deny") return verdict
  const why = provenance.taint(tool, input)
  if (!why) {
    // D-016: a value from an untrusted source sent on. It can only escalate, never allow.
    const egress = provenance.egress(tool, input, cwd)
    if (!egress) return verdict
    return {
      ...verdict,
      outcome: "escalate",
      // Owner, 13 Nov: a fetch is held under its own rule, which Extreme approval and a session's tool grant answer,
      // after a result that looked like prompt injection too ("this and the approval issue are blocking my use of the
      // app"). Network commands such as curl stay under EGRESS_RULE, which neither answers.
      ruleId: tool === "WebFetch" ? FETCH_RULE : EGRESS_RULE,
      reason: `${egress} (${verdict.outcome === "allow" ? "allowed" : "held"} by rule ${verdict.ruleId} otherwise.)`,
      risk: Math.min(100, Math.max(70, verdict.risk + 20)),
    }
  }
  return {
    ...verdict,
    outcome: "escalate",
    ruleId: TAINT_RULE,
    reason: `${why} (${verdict.outcome === "allow" ? "allowed" : "held"} by rule ${verdict.ruleId} otherwise.)`,
    risk: Math.min(100, Math.max(70, verdict.risk + 20)),
  }
}
