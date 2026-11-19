import crypto from "node:crypto"
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import type { Verdict } from "@gatehouse/shared"
import type { SecretTerms } from "./secret-providers.js"

/**
 * T-135 (safe variant): a session asks you for a secret (a package registry token, say) for one command, and the value
 * never enters the conversation.
 * - It asks with the Companion's request_secret tool: a name, why, and the exact command it is for. A card shows on
 *   the desktop only, never the phone or a push channel (invariants 9 and 11). You type the value there, or decline.
 * - The value is kept in memory for that session only and added to the redaction terms at once (invariant 12), so it is
 *   taken out of the audit, logs and anything sent. It is recorded by name only.
 * - When the session then runs exactly that command (Bash or PowerShell), the call is decided as it stands, without
 *   the value. Only if it is allowed does Codehouse set the variable for that one run, as an edited input checked by
 *   the floor and the policy again (invariant 10), with the value masked for that check so no evaluator sees it. One use.
 * - A name Codehouse or Claude Code relies on (ANTHROPIC_*, CLAUDE_*, GATEHOUSE_*, PATH and the like) is refused, and
 *   so is a value that is an Anthropic credential (invariant 6).
 */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
const RESERVED = /^(ANTHROPIC_|CLAUDE_|GATEHOUSE_|CODEHOUSE_|AWS_PROFILE$|PATH$|PATHEXT$|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|COMSPEC$|SHELL$|NODE_OPTIONS$|PSMODULEPATH$|SYSTEMROOT$|TEMP$|TMP$)/
const ANTHROPIC = /sk-ant-/i
export const MAX_SECRET = 4096
export const ASK_MS = 10 * 60_000
export const MASK = "[secret]"

export interface SecretAsk {
  id: string
  sessionId: string
  name: string
  reason: string
  command: string
  at: string
}

/** Why a request is refused, or undefined. */
export function refuseRequest(name: string, command: string): string | undefined {
  if (!SECRET_NAME.test(name)) return "A secret's name is capitals, digits and underscores, such as NPM_TOKEN."
  if (RESERVED.test(name)) return `${name} is a name Codehouse or Claude Code relies on, so it cannot be set this way.`
  if (!command.trim() || command.length > 2000) return "Give the exact command the secret is for, up to 2,000 characters."
  return undefined
}

/** Why a value is refused, or undefined. */
export function refuseValue(value: string): string | undefined {
  if (!value) return "Nothing was given."
  if (value.length > MAX_SECRET) return `A secret is up to ${MAX_SECRET} characters.`
  if (value.includes(String.fromCharCode(0))) return "A secret cannot hold a null character."
  if (ANTHROPIC.test(value)) return "That is an Anthropic credential. Codehouse never passes one to a command."
  return undefined
}

/** The command with the variable set for it alone, in the shell the tool runs. Single quotes: nothing in it runs. */
export function withSecret(tool: "Bash" | "PowerShell", command: string, name: string, value: string): string {
  return tool === "PowerShell"
    ? `$env:${name} = '${value.replace(/'/g, "''")}'; ${command}`
    : `export ${name}='${value.replace(/'/g, `'\\''`)}' && ${command}`
}

const norm = (c: string) => c.trim().replace(/\r\n/g, "\n")

export class SecretRequests {
  readonly #asks = new Map<string, SecretAsk & { resolve: (r: "given" | "declined") => void }>()
  readonly #ready = new Map<string, Array<{ name: string; value: string; command: string }>>()

  constructor(
    private readonly terms: SecretTerms,
    private readonly onChange: () => void = () => undefined,
  ) {}

  /** What waits for you, without values. */
  pending(): SecretAsk[] {
    return [...this.#asks.values()].map(({ resolve: _r, ...a }) => a)
  }

  /** A session asks. Resolves when you answer, decline, or after ASK_MS. */
  ask(sessionId: string, name: string, reason: string, command: string, ms = ASK_MS): Promise<"given" | "declined" | "timeout"> {
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.#asks.delete(id)) this.onChange()
        resolve("timeout")
      }, ms)
      timer.unref?.()
      this.#asks.set(id, {
        id,
        sessionId,
        name,
        reason: reason.slice(0, 300),
        command,
        at: new Date().toISOString(),
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
      })
      this.onChange()
    })
  }

  /** Your answer from the desktop: the value, or nothing to decline. A reason in words when refused. */
  answer(id: string, value: string | undefined): string | undefined {
    const a = this.#asks.get(id)
    if (!a) return "That request is no longer waiting."
    if (value !== undefined) {
      const why = refuseValue(value)
      if (why) return why
      this.terms.add(value)
      const list = (this.#ready.get(a.sessionId) ?? []).filter((x) => x.name !== a.name)
      this.#ready.set(a.sessionId, [...list, { name: a.name, value, command: norm(a.command) }])
    }
    this.#asks.delete(id)
    a.resolve(value === undefined ? "declined" : "given")
    this.onChange()
    return undefined
  }

  /** The secret for this exact command in this session, once. */
  take(sessionId: string, command: string): { name: string; value: string } | undefined {
    const list = this.#ready.get(sessionId) ?? []
    const at = list.findIndex((x) => x.command === norm(command))
    if (at < 0) return undefined
    const [s] = list.splice(at, 1)
    return { name: s!.name, value: s!.value }
  }

  /** The session ended: what it was given and what it asked for go. */
  forget(sessionId: string): void {
    this.#ready.delete(sessionId)
    for (const a of this.#asks.values()) if (a.sessionId === sessionId) this.answer(a.id, undefined)
  }
}

export interface SecretUseDeps {
  sessionId: string
  secrets: SecretRequests
  /** Floor first, then the full policy: a denying verdict when the edited input must not run (invariant 10). */
  recheck: (toolName: string, input: Record<string, unknown>, options: Parameters<CanUseTool>[2]) => Promise<Verdict | undefined>
  record: (name: string, ok: boolean, why: string) => Promise<boolean>
}

const denied = (message: string, toolUseID: string): PermissionResult => ({ behavior: "deny", message, toolUseID })

/** canUseTool, with a secret set for the one command it was given for, after that command is allowed as it stands. */
export function withSecrets(inner: CanUseTool, d: SecretUseDeps): CanUseTool {
  return async (toolName, input, options) => {
    const result = await inner(toolName, input, options)
    if (!result || result.behavior !== "allow" || (toolName !== "Bash" && toolName !== "PowerShell")) return result
    const command = typeof input.command === "string" ? input.command : ""
    const base = (result.updatedInput ?? input) as Record<string, unknown>
    // A person who edited the command made it another command: it gets no secret.
    if (base.command !== command) return result
    const s = d.secrets.take(d.sessionId, command)
    if (!s) return result
    const blocked = await d.recheck(toolName, { ...base, command: withSecret(toolName, command, s.name, MASK) }, options)
    if (blocked) {
      await d.record(s.name, false, `The command with ${s.name} set was blocked: ${blocked.reason}`)
      return denied(`With ${s.name} set, this command was blocked: ${blocked.reason} (rule ${blocked.ruleId})`, options.toolUseID)
    }
    if (!(await d.record(s.name, true, `${s.name} was set for one run of the command it was given for.`)))
      return denied("Setting the secret could not be recorded in the audit log, so the command did not run.", options.toolUseID)
    return { ...result, updatedInput: { ...base, command: withSecret(toolName, command, s.name, s.value) } }
  }
}
