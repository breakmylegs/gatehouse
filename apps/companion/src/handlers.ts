import { z } from "zod"
import { createCheckpoint as defaultCheckpoint } from "@gatehouse/shared/node"
import type { Policy } from "@gatehouse/policy"
import type { HostClient } from "./host-client.js"
import { secretGlobs, summarisePolicy } from "./summary.js"

export const NOTIFY_MAX_CHARS = 140
export const NOTIFY_INTERVAL_MS = 60_000

export interface CompanionDeps {
  sessionId: string
  cwd: string
  host: HostClient
  /** Called each time, so a hot-reloaded policy is seen. */
  policy: () => Policy | undefined
  redact: <T>(value: T) => T
  now?: () => number
  checkpoint?: typeof defaultCheckpoint
}

export interface ToolText {
  text: string
  isError?: boolean
}

function oneLine(text: string): string {
  return [...text]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
}

/** The three agent-facing tools. Plain functions, so a stdio server and an in-process server share them. */
export class CompanionHandlers {
  readonly #deps: CompanionDeps
  #lastNotify: number | undefined

  constructor(deps: CompanionDeps) {
    this.#deps = deps
  }

  async notifyUser(text: string): Promise<ToolText> {
    const clean = oneLine(text)
    if (clean === "") return { text: "Not sent: the message is empty.", isError: true }
    if (clean.length > NOTIFY_MAX_CHARS) {
      return {
        text: `Not sent: ${clean.length} characters is too long, the limit is ${NOTIFY_MAX_CHARS}.`,
        isError: true,
      }
    }
    const now = (this.#deps.now ?? Date.now)()
    if (this.#lastNotify !== undefined && now - this.#lastNotify < NOTIFY_INTERVAL_MS) {
      const wait = Math.ceil((NOTIFY_INTERVAL_MS - (now - this.#lastNotify)) / 1000)
      return {
        text: `Not sent: only one notification a minute is allowed. Try again in ${wait} seconds.`,
      }
    }
    // Claim the slot before waiting on the Host, so two calls at once cannot both send.
    const previous = this.#lastNotify
    this.#lastNotify = now
    const sent = await this.#deps.host.notify({
      sessionId: this.#deps.sessionId,
      text: this.#deps.redact(clean).slice(0, NOTIFY_MAX_CHARS),
    })
    if (!sent) {
      this.#lastNotify = previous
      return { text: "Not sent: the JCVC host could not be reached." }
    }
    return { text: "Sent." }
  }

  async createCheckpoint(label: string): Promise<ToolText> {
    const policy = this.#deps.policy()
    if (!policy)
      return {
        text: "No checkpoint: no policy is loaded, so secrets files cannot be excluded safely.",
        isError: true,
      }
    try {
      const make = this.#deps.checkpoint ?? defaultCheckpoint
      const cp = await make({
        cwd: this.#deps.cwd,
        sessionId: this.#deps.sessionId,
        label: this.#deps.redact(label),
        excludeGlobs: secretGlobs(policy),
      })
      return { text: `Checkpoint saved as ${cp.ref}. JCVC can restore it if this goes wrong.` }
    } catch (e) {
      return { text: `No checkpoint: ${(e as Error).message}`, isError: true }
    }
  }

  getPolicySummary(): ToolText {
    return { text: summarisePolicy(this.#deps.policy(), this.#deps.cwd) }
  }
}

export interface CompanionToolDef {
  name: "notify_user" | "create_checkpoint" | "get_policy_summary"
  description: string
  shape: z.ZodRawShape
  /**
   * Stated, not left to defaults: Claude Code reads an unset destructiveHint as false, and in Auto mode its classifier
   * treats these as safe to run. None of them changes your files; notify_user reaches you outside this computer.
   */
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  run: (handlers: CompanionHandlers, args: Record<string, unknown>) => Promise<ToolText> | ToolText
}

/** One definition of each tool, used by both the stdio server and the Host's in-process server. */
export const COMPANION_TOOLS: readonly CompanionToolDef[] = [
  {
    name: "notify_user",
    description: `Send the user a short phone and desktop notification (at most ${NOTIFY_MAX_CHARS} characters, one a minute). Use it when you finish something long or are stuck and need them.`,
    shape: {
      text: z
        .string()
        .min(1)
        .max(NOTIFY_MAX_CHARS * 4),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    run: (h, a) => h.notifyUser(String(a.text ?? "")),
  },
  {
    name: "create_checkpoint",
    description:
      "Save a restorable snapshot of the working tree before a risky change. Does not touch your files or git index.",
    shape: { label: z.string().min(1).max(200) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    run: (h, a) => h.createCheckpoint(String(a.label ?? "")),
  },
  {
    name: "get_policy_summary",
    description:
      "Describe what runs without approval, so you can pick commands that will not wait for the user.",
    shape: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    run: (h) => h.getPolicySummary(),
  },
]
