import { Verdict } from "@gatehouse/shared"

export interface ApproverClientOptions {
  /** For example http://127.0.0.1:47821/mcp */
  url: string
  token: string
  /**
   * The limit for one evaluation, APPROVER_TIMEOUT_MS unless given. It may be a function, because the optional
   * judge makes a judge-eligible call slower (a model call) and the Host allows for that only while the policy has
   * it on.
   */
  timeoutMs?: number | (() => number)
}

export interface EvaluateCall {
  toolName: string
  input: Record<string, unknown>
}

export interface EvaluateCtx {
  cwd: string
  sessionId: string
  projectRoot?: string
  toolUseId?: string
  /** `options.mcpServer.source` from the SDK for mcp__ tools. */
  mcpSource?: string
}

/**
 * How long the Host waits for one evaluation. The spec said 5 seconds; an answer that takes 30 ms on a quiet
 * laptop took 7 on a busy one, so 15. Past it the call still escalates (invariant 1).
 */
export const APPROVER_TIMEOUT_MS = 15_000

/** What the Host acts on whenever the Approver cannot give a valid answer. It is never an allow. */
export function unavailableVerdict(why: string): Verdict {
  return {
    outcome: "escalate",
    ruleId: "evaluator-unavailable",
    reason: `The policy evaluator could not be reached (${why}), so this needs your approval.`,
    risk: 50,
    decidedBy: "evaluator-unavailable",
    policyHash: "none",
  }
}

/**
 * Calls the Approver's evaluate_permission tool. The Approver is stateless, so each call is a single
 * JSON-RPC request. Any failure (down, slow, refused, garbled, wrong shape) becomes an escalation, which is
 * invariant 1: the Host never turns a failure into an allow, and this never throws.
 */
export class ApproverClient {
  readonly #opts: Required<ApproverClientOptions>
  #id = 0

  constructor(opts: ApproverClientOptions) {
    this.#opts = { timeoutMs: APPROVER_TIMEOUT_MS, ...opts }
  }

  async evaluate(call: EvaluateCall, ctx: EvaluateCtx): Promise<Verdict> {
    try {
      const result = await this.#callTool("evaluate_permission", {
        toolName: call.toolName,
        input: call.input,
        ctx,
      })
      const parsed = Verdict.safeParse(result.structuredContent)
      if (!parsed.success) return unavailableVerdict("malformed answer")
      return parsed.data
    } catch (e) {
      return unavailableVerdict(describe(e))
    }
  }

  /**
   * Engages or re-arms the Approver's deny-all switch. Resolves true only when the Approver confirmed the
   * new state. It never throws: when the Approver is down the Host's own flag still denies everything.
   */
  async setKillSwitch(engaged: boolean, by?: string, reason?: string): Promise<boolean> {
    try {
      const result = await this.#callTool("kill_switch", {
        engaged,
        ...(by !== undefined ? { by } : {}),
        ...(reason !== undefined ? { reason } : {}),
      })
      return (result.structuredContent as { engaged?: boolean } | undefined)?.engaged === engaged
    } catch {
      return false
    }
  }

  /** The Approver's policy_status, or undefined when it cannot be reached. */
  async status(): Promise<Record<string, unknown> | undefined> {
    try {
      const result = await this.#callTool("policy_status", {})
      return result.structuredContent as Record<string, unknown>
    } catch {
      return undefined
    }
  }

  async #callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ structuredContent?: unknown; isError?: boolean }> {
    const res = await fetch(this.#opts.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${this.#opts.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.#id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(
        typeof this.#opts.timeoutMs === "function" ? this.#opts.timeoutMs() : this.#opts.timeoutMs,
      ),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as {
      result?: { structuredContent?: unknown; isError?: boolean }
      error?: unknown
    }
    if (body.error !== undefined || body.result === undefined) throw new Error("error reply")
    if (body.result.isError) throw new Error("tool error")
    return body.result
  }
}

function describe(e: unknown): string {
  const err = e as { name?: string; cause?: { code?: string }; message?: string }
  if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out"
  if (err.cause?.code) return err.cause.code
  return err.message ?? "unknown error"
}
