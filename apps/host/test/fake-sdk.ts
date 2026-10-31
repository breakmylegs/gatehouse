import type {
  AccountInfo,
  HookCallback,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import type { QueryFn } from "../src/account.js"

export interface ToolCallResult {
  executed: boolean
  /** Which stage stopped the call. */
  blockedBy?: "hook" | "permission"
  message?: string
  /** The input the tool would have run with (the edited input if canUseTool changed it). */
  input?: Record<string, unknown>
  permission?: PermissionResult
  canUseToolCalled: boolean
}

export interface TurnApi {
  sessionId: string
  signal: AbortSignal
  /**
   * Behaves like Claude Code: PreToolUse hooks first, then canUseTool (unless `selfApproved`, which models
   * a call Claude Code approves by itself), then PostToolUse.
   */
  callTool(
    toolName: string,
    input: Record<string, unknown>,
    opts?: { selfApproved?: boolean; toolUseId?: string; mcpSource?: string },
  ): Promise<ToolCallResult>
  say(text: string): void
  /** Emits a raw system message, for example a warning. */
  system(message: Record<string, unknown>): void
}

export type TurnScript = (api: TurnApi, userText: string) => Promise<void>

export interface FakeQueryHandle {
  options: Options
  closed: boolean
  interrupts: number
  modes: string[]
  models: (string | undefined)[]
  flags: Record<string, unknown>[]
  prompts: string[]
  permissionResults: PermissionResult[]
  /** Background tasks stopped through stopTask. */
  stopped: string[]
  /** Sends a message on the stream at any time, between turns too. */
  emit(m: Record<string, unknown>): void
  initializationResult(): Promise<{ account: AccountInfo }>
}

/** A stand-in for the SDK's query(). It exercises the Host's real hooks and canUseTool. */
export class FakeSdk {
  account: AccountInfo | undefined = {
    email: "test@example.com",
    organization: "ACN - Premium",
    subscriptionType: "Claude Enterprise",
    apiProvider: "firstParty",
  }
  turn: TurnScript = async () => undefined
  readonly queries: FakeQueryHandle[] = []
  /** Cost reported by each result message. */
  costPerTurn = 0.01
  /** What the experimental usage call answers, in order. */
  usageAnswers: unknown[] = [{ rate_limits_available: false, rate_limits: null }]
  /** What mcpServerStatus answers: by default only the in-process Companion. */
  mcpStatus: unknown[] = [
    { name: "companion", status: "connected", config: { type: "sdk", name: "companion" }, source: "sdk" },
  ]
  usageCalls = 0
  #toolCounter = 0

  readonly queryFn: QueryFn = ({ prompt, options }) => {
    const opts = options ?? ({} as Options)
    const out: SDKMessage[] = []
    let wake: (() => void) | undefined
    let ended = false
    let turns = 0
    let lastSaid = ""
    let toolsThisTurn = 0
    let currentAbort: AbortController | undefined
    const handle: FakeQueryHandle = {
      options: opts,
      closed: false,
      interrupts: 0,
      modes: [],
      models: [],
      flags: [],
      prompts: [],
      permissionResults: [],
      stopped: [],
      emit: () => undefined,
      initializationResult: async () => ({ account: this.account as AccountInfo }),
    }
    this.queries.push(handle)
    const sessionId = `sdk-${this.queries.length}`

    const push = (m: Record<string, unknown>) => {
      out.push({ session_id: sessionId, ...m } as unknown as SDKMessage)
      wake?.()
    }
    handle.emit = push
    push({
      type: "system",
      subtype: "init",
      model: "fake-model",
      cwd: opts.cwd,
      tools: [],
      mcp_servers: [],
    })

    const hook = async (
      event: "PreToolUse" | "PostToolUse",
      toolName: string,
      input: Record<string, unknown>,
      id: string,
      signal: AbortSignal,
    ) => {
      const callbacks = (
        (opts.hooks as Record<string, { hooks: HookCallback[] }[]> | undefined)?.[event] ?? []
      ).flatMap((m) => m.hooks)
      let last: unknown = {}
      for (const cb of callbacks) {
        last = await cb(
          {
            hook_event_name: event,
            tool_name: toolName,
            tool_input: input,
            tool_use_id: id,
            cwd: opts.cwd,
            session_id: sessionId,
            ...(event === "PostToolUse" ? { tool_response: {} } : {}),
          } as never,
          id,
          { signal },
        )
        const decision = (last as { hookSpecificOutput?: { permissionDecision?: string } })
          .hookSpecificOutput?.permissionDecision
        if (decision === "deny") return last
      }
      return last
    }

    const makeApi = (signal: AbortSignal): TurnApi => ({
      sessionId,
      signal,
      say: (text) => {
        lastSaid = text
        push({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text }] },
        })
      },
      system: (m) => push({ type: "system", ...m }),
      callTool: async (toolName, input, o = {}) => {
        toolsThisTurn++
        const id = o.toolUseId ?? `toolu_${++this.#toolCounter}`
        const pre = (await hook("PreToolUse", toolName, input, id, signal)) as {
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
        }
        if (pre.hookSpecificOutput?.permissionDecision === "deny") {
          return {
            executed: false,
            blockedBy: "hook",
            message: pre.hookSpecificOutput.permissionDecisionReason,
            canUseToolCalled: false,
          }
        }
        let finalInput = input
        let permission: PermissionResult | undefined
        let called = false
        // As the SDK documents: a hook's "ask" sends the call to canUseTool even where the mode would have approved
        // it by itself.
        if (!o.selfApproved || pre.hookSpecificOutput?.permissionDecision === "ask") {
          called = true
          permission =
            (await opts.canUseTool!(toolName, input, {
              signal,
              toolUseID: id,
              requestId: `req-${id}`,
              ...(o.mcpSource
                ? { mcpServer: { name: toolName.split("__")[1] ?? "x", source: o.mcpSource } }
                : {}),
            } as never)) ?? undefined
          if (permission) handle.permissionResults.push(permission)
          if (!permission || permission.behavior !== "allow") {
            return {
              executed: false,
              blockedBy: "permission",
              message:
                permission && permission.behavior === "deny" ? permission.message : undefined,
              permission,
              canUseToolCalled: true,
            }
          }
          finalInput = permission.updatedInput ?? input
        }
        await hook("PostToolUse", toolName, finalInput, id, signal)
        push({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
          },
        })
        return { executed: true, input: finalInput, permission, canUseToolCalled: called }
      },
    })

    // Turn loop: one turn per user message.
    void (async () => {
      try {
        for await (const msg of prompt as AsyncIterable<SDKUserMessage>) {
          const text =
            typeof msg.message.content === "string"
              ? msg.message.content
              : JSON.stringify(msg.message.content)
          handle.prompts.push(text)
          lastSaid = ""
          toolsThisTurn = 0
          currentAbort = new AbortController()
          try {
            await this.turn(makeApi(currentAbort.signal), text)
          } catch (e) {
            push({
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "text", text: `turn error: ${(e as Error).message}` }],
              },
            })
          }
          // Like the real SDK: `usage` is for this result, while the cost and modelUsage are cumulative.
          turns++
          push({
            type: "result",
            subtype: "success",
            is_error: false,
            duration_ms: 5,
            // Like the real SDK: one call to Claude, and one more after each tool call.
            num_turns: 1 + toolsThisTurn,
            result: lastSaid,
            total_cost_usd: this.costPerTurn * turns,
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 5,
              cache_creation_input_tokens: 1,
            },
            modelUsage: {
              "fake-model": {
                inputTokens: 100 * turns,
                outputTokens: 20 * turns,
                cacheReadInputTokens: 5 * turns,
                cacheCreationInputTokens: turns,
                costUSD: this.costPerTurn * turns,
              },
            },
          })
          currentAbort = undefined
        }
      } finally {
        ended = true
        wake?.()
      }
    })()

    const q = {
      async next(): Promise<IteratorResult<SDKMessage, void>> {
        for (;;) {
          const item = out.shift()
          if (item) return { value: item, done: false }
          if (ended || handle.closed) return { value: undefined, done: true }
          await new Promise<void>((r) => (wake = r))
        }
      },
      async return(): Promise<IteratorResult<SDKMessage, void>> {
        handle.closed = true
        return { value: undefined, done: true }
      },
      async throw(e: unknown): Promise<IteratorResult<SDKMessage, void>> {
        throw e
      },
      [Symbol.asyncIterator]() {
        return this
      },
      async interrupt() {
        handle.interrupts++
        currentAbort?.abort()
        return undefined
      },
      async stopTask(taskId: string) {
        handle.stopped.push(taskId)
        push({ type: "system", subtype: "task_notification", task_id: taskId, status: "stopped" })
      },
      async setPermissionMode(mode: string) {
        handle.modes.push(mode)
      },
      async setModel(model?: string) {
        handle.models.push(model)
      },
      async applyFlagSettings(flags: Record<string, unknown>) {
        handle.flags.push(flags)
      },
      async initializationResult() {
        return handle.initializationResult()
      },
      mcpServerStatus: async () => this.mcpStatus,
      // The /usage data, one answer per call from the list, then the last again.
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        this.usageCalls++
        return this.usageAnswers.length > 1 ? this.usageAnswers.shift() : this.usageAnswers[0]
      },
      close() {
        handle.closed = true
        wake?.()
      },
    }
    return q as unknown as Query
  }
}
