/**
 * The provider contract (multi-provider S-01, ADR 0009): what a provider adapter must offer so a non-Claude model can
 * one day run in Codehouse under the same invariants. Off unless `providers.multi.enabled` is set, and no adapter but
 * Claude's exists yet.
 *
 * Two shapes of adapter (ADR 0008):
 * - "wrap": a vendor agent runs the tools and calls Codehouse's gate from its own pre-execution hook (Claude, today);
 * - "loop": Codehouse runs the agent loop, the model can only ask for a tool, and Codehouse's executor runs it after the gate.
 *
 * There is no bypass in these types. A mode is one of Codehouse's four (invariant 3), and the registry refuses an adapter
 * that declares a vendor setting that approves by itself.
 */

/** e.g. "claude-agent-sdk"; later "azure-openai", "local-ollama". */
export type ProviderId = string
export type Pattern = "wrap" | "loop"
/** Codehouse's modes, by their SDK names (Manual is "default"). No bypass value exists. */
export type ProviderMode = "default" | "plan" | "acceptEdits" | "auto"
export type ProviderEffort = "minimal" | "low" | "medium" | "high" | "max"
/** Where a session's words go: this computer, a provider that keeps nothing, or one that keeps them a while. */
export type DataBoundary = "local" | "hosted-zdr" | "hosted-retained"

export interface ProviderCapabilities {
  pattern: Pattern
  streaming: boolean
  resume: boolean
  fork: boolean
  compaction: "native" | "app" | "none"
  subagents: "native" | "app" | "none"
  inProcessMcp: boolean
  /** A vendor's own hosted search is never switched on (ADR 0009): search is a Codehouse tool or absent. */
  webSearch: "app-tool" | "none"
  imageInput: boolean
  fileInput: boolean
  effortLevels: ProviderEffort[]
  reportsUsage: boolean
  reportsRateLimits: boolean
  dataBoundary: DataBoundary
  /**
   * The vendor settings the adapter runs its agent with, for a wrap adapter, so the registry can refuse one that
   * approves by itself. Empty for a loop adapter, where nothing runs but Codehouse's executor.
   */
  vendorSettings: Record<string, string | boolean>
}

export interface OrgAssertion {
  provider: ProviderId
  /** A tenant, workspace, project or team id. */
  orgId: string
  /** For display only, redacted before it is recorded. */
  accountLabel: string
  /** How the organisation was found, e.g. "init.account.organization". */
  verifiedBy: string
}

/**
 * The tools Codehouse can run itself. Their inputs have the shape of the Claude Code tool of the same kind (`vendorTool`
 * below), so the floor, the rules and the Approver judge a call from any provider exactly as they judge Claude's.
 */
export type CanonicalTool =
  | "read"
  | "write"
  | "edit"
  | "shell"
  | "glob"
  | "grep"
  | "webFetch"
  | "webSearch"
  | "mcp"
  | "subagent"

export interface ToolCall {
  callId: string
  sessionId: string
  provider: ProviderId
  tool: CanonicalTool
  /** The name the provider used, kept for the audit log. */
  vendorToolName: string
  input: Record<string, unknown>
}

/** The gate's answer. An allow carries the input that may run, which may have been edited, and its hash. */
export type GateVerdict =
  | { kind: "allow"; callId: string; input: Record<string, unknown>; inputHash: string }
  | { kind: "deny"; callId: string; ruleId: string; reason: string }

/**
 * The one way into the floor, the Approver and a person. Any error, timeout or malformed answer is a deny
 * (invariant 1); `failClosed` in gate.ts makes that true of any gate.
 */
export interface Gate {
  decide(call: ToolCall, signal: AbortSignal): Promise<GateVerdict>
}

export interface UsageReport {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
  costMicroUsd?: number
  priceTableVersion?: string
  rateLimit?: {
    remainingRequests?: number
    remainingTokens?: number
    resetAt?: string
    source: string
  }
}

export type SessionEvent =
  | { type: "text"; delta: string }
  | { type: "toolRequested"; call: ToolCall }
  | { type: "toolResult"; callId: string; ok: boolean; output: string; untrusted: true }
  | { type: "usage"; usage: UsageReport }
  | { type: "error"; code: string; message: string }
  | { type: "done"; stopReason: string }

export interface ProviderSessionOptions {
  model?: string
  effort?: ProviderEffort
  mode: ProviderMode
  workspaceRoot: string
  resumeFrom?: string
}

export interface ProviderAdapter {
  readonly id: ProviderId
  /** Shown in the window, as text: no vendor logo (ADR 0011). */
  readonly label: string
  capabilities(): ProviderCapabilities
  /** Must refuse, before any session starts, an account outside the expected organisations (invariant 14). */
  assertOrganisation(expectedOrgIds: string[]): Promise<OrgAssertion>
}
