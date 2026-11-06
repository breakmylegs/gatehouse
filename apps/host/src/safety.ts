import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { STRIPPED_ENV_VARS } from "@gatehouse/shared"

export class SafetyError extends Error {
  constructor(
    readonly invariant: number,
    message: string,
  ) {
    super(`Invariant ${invariant}: ${message}`)
  }
}

/**
 * default (Manual), plan, and, since the owner asked on 28 Oct, acceptEdits and auto. Every one of them still runs the
 * PreToolUse floor and is audited (what Claude Code approves by itself is recorded by the PostToolUse hook). The ones
 * that skip every check are never allowed: bypassPermissions and dontAsk.
 */
export const ALLOWED_MODES = ["default", "plan", "acceptEdits", "auto"] as const
export type SessionMode = (typeof ALLOWED_MODES)[number]

export function isAllowedMode(mode: unknown): mode is SessionMode {
  return typeof mode === "string" && (ALLOWED_MODES as readonly string[]).includes(mode)
}

/** True for a tool name with no argument pattern, such as `Bash` or `mcp__x__y`. */
export function isBareToolName(entry: string): boolean {
  return !entry.includes("(")
}

/**
 * Runs just before a session is created and refuses anything that would weaken Gatehouse. These are the
 * rules that cannot be left to a test alone, because one wrong option would silently turn the approvals off:
 *  3  the mode is set, and is one of ALLOWED_MODES, never bypassPermissions or dontAsk or an equivalent;
 *  4  allowedTools has no bare tool names (they would approve calls before canUseTool sees them);
 *  5  nothing else supplies permissions (settings, a prompt tool, extra CLI flags, agent modes);
 *  6  the environment is given explicitly and holds no credentials, and the binary is the bundled one.
 * It also requires that canUseTool and the PreToolUse floor hook are present.
 */
/**
 * The one inline setting Codehouse sets itself: Claude Code's own auto memory off for a chat, so there is one memory to
 * edit (ADR 0006). An object with that key and nothing else; anything more could carry permission rules.
 */
export function isOnlyAutoMemoryOff(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false
  const keys = Object.keys(settings as Record<string, unknown>)
  return (
    keys.length === 1 &&
    keys[0] === "autoMemoryEnabled" &&
    (settings as Record<string, unknown>).autoMemoryEnabled === false
  )
}

/** An output style's name as Settings may hold it: a few words, never a path or anything more. */
export const OUTPUT_STYLE_NAME = /^[A-Za-z0-9][\w .-]{0,59}$/

/**
 * The inline settings Codehouse may set: auto memory off (above), installed plugins off for one session (B39, a
 * plugin's evaluation without it), and the output style chosen in Settings, by name (owner's Settings overhaul,
 * 6 Nov). A plugin can never be turned on here, and nothing else may be set, since anything more could carry
 * permission rules.
 */
export function isSafeInlineSettings(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false
  const s = settings as Record<string, unknown>
  const keys = Object.keys(s)
  const allowed = new Set(["autoMemoryEnabled", "enabledPlugins", "outputStyle"])
  if (!keys.length || keys.some((k) => !allowed.has(k))) return false
  if ("autoMemoryEnabled" in s && s.autoMemoryEnabled !== false) return false
  if ("outputStyle" in s && !(typeof s.outputStyle === "string" && OUTPUT_STYLE_NAME.test(s.outputStyle)))
    return false
  if (!("enabledPlugins" in s)) return true
  const p = s.enabledPlugins
  if (!p || typeof p !== "object" || Array.isArray(p)) return false
  const entries = Object.entries(p as Record<string, unknown>)
  return (
    entries.length > 0 && entries.every(([id, v]) => /^[\w.-]+@[\w.-]+$/.test(id) && v === false)
  )
}

export function assertSafeOptions(options: Options): void {
  if (options.permissionMode === undefined) {
    throw new SafetyError(3, "the permission mode must be set explicitly on every session")
  }
  if (!isAllowedMode(options.permissionMode)) {
    throw new SafetyError(
      3,
      `permission mode "${String(options.permissionMode)}" is not allowed, only default, plan, acceptEdits and auto`,
    )
  }
  if (options.allowDangerouslySkipPermissions) {
    throw new SafetyError(3, "allowDangerouslySkipPermissions must never be set")
  }
  const bare = (options.allowedTools ?? []).filter(isBareToolName)
  if (bare.length > 0) {
    throw new SafetyError(
      4,
      `allowedTools has bare tool names (${bare.join(", ")}), which skip canUseTool`,
    )
  }
  if (options.settings !== undefined && !isSafeInlineSettings(options.settings)) {
    throw new SafetyError(5, "inline settings are not allowed, they could carry permission rules")
  }
  if (options.permissionPromptToolName !== undefined) {
    throw new SafetyError(
      5,
      "permissionPromptToolName replaces canUseTool and must not be used by the Host",
    )
  }
  if (options.extraArgs !== undefined && Object.keys(options.extraArgs).length > 0) {
    throw new SafetyError(5, "extra command line arguments are not allowed")
  }
  for (const [name, agent] of Object.entries(options.agents ?? {})) {
    if (agent.permissionMode !== undefined && !isAllowedMode(agent.permissionMode)) {
      throw new SafetyError(3, `agent ${name} sets permission mode ${agent.permissionMode}`)
    }
  }
  if (options.pathToClaudeCodeExecutable !== undefined) {
    throw new SafetyError(6, "only the bundled, unmodified Claude Code binary may be used")
  }
  if (options.env === undefined) {
    throw new SafetyError(
      6,
      "the environment must be passed explicitly so credentials in the parent are not inherited",
    )
  }
  const banned = new Set<string>(STRIPPED_ENV_VARS.map((n) => n.toUpperCase()))
  for (const key of Object.keys(options.env)) {
    if (banned.has(key.toUpperCase()))
      throw new SafetyError(6, `${key} must not be passed to a session`)
  }
  if (typeof options.canUseTool !== "function") {
    throw new SafetyError(1, "canUseTool must be set so every prompt reaches Codehouse")
  }
  if ((options.hooks?.PreToolUse?.length ?? 0) === 0) {
    throw new SafetyError(2, "the PreToolUse floor hook must be registered")
  }
}

/**
 * Owner's rule of 31 Oct: a session uses only in-process SDK MCP servers (the Companion). The managed policy on this
 * laptop already blocks the rest; Codehouse checks for itself too. Returns the servers, from `mcpServerStatus()`, that run
 * outside the process (stdio, SSE or HTTP) and are connected or connecting. A claude.ai connector goes through
 * Anthropic's own proxy and is not a server on this computer, so it is left to the policy.
 */
export function outOfProcessServers(statuses: unknown): string[] {
  if (!Array.isArray(statuses)) return []
  const out: string[] = []
  for (const raw of statuses) {
    const s = (raw ?? {}) as { name?: unknown; status?: unknown; config?: unknown }
    const c = (s.config ?? {}) as { type?: unknown; command?: unknown }
    const outside =
      c.type === "stdio" ||
      c.type === "sse" ||
      c.type === "http" ||
      (c.type === undefined && typeof c.command === "string")
    if (outside && (s.status === "connected" || s.status === "pending"))
      out.push(typeof s.name === "string" ? s.name : "unnamed")
  }
  return out
}

/** The code the SDK gives its warning (Agent SDK 0.3.310, sdk.mjs: process.emitWarning(text, { code })). */
export const SHADOW_CODE = "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED"
// The code, or the SDK's own sentence ("canUseTool will not be invoked for: Bash. Bare allowedTools entries...").
const SHADOWED = /CLAUDE_SDK_CAN_USE_TOOL_SHADOWED|canUseTool will not be invoked for:/

/**
 * Invariant 4: a warning that canUseTool is being shadowed (some rule approves calls before it is asked) is fatal.
 * Only the SDK's own code or sentence counts. An earlier, looser pattern ("canUseTool ... shadow") stopped a session
 * whenever a subagent's report merely quoted the warning (owner, 4 Nov).
 */
export function isShadowWarning(text: string): boolean {
  return SHADOWED.test(text)
}

/**
 * System messages that carry what Claude, a subagent, a hook or a command wrote: a quote of the warning there is
 * text, not the SDK warning, so these are not read for it.
 */
export const CONTENT_SUBTYPES = new Set([
  "task_notification",
  "task_progress",
  "task_started",
  "task_updated",
  "local_command_output",
  "hook_response",
  "hook_progress",
  "hook_started",
  "compact_boundary",
  "memory_recall",
  "files_persisted",
  "notification",
])

/** Whether a system message is the SDK's shadow warning, never a message that only carries text quoting it. */
export function isShadowSystemMessage(m: Record<string, unknown>): boolean {
  if (typeof m.subtype === "string" && CONTENT_SUBTYPES.has(m.subtype)) return false
  return isShadowWarning(JSON.stringify(m))
}

/**
 * The SDK raises its warning in this process (process.emitWarning) while query() reads the options, and Node hands
 * it to "warning" listeners on the next tick. Watch from just before query() until after that tick; returns how to
 * stop watching.
 */
export function watchShadowWarning(onShadow: () => void): () => void {
  const on = (w: Error & { code?: string }) => {
    if (w.code === SHADOW_CODE || isShadowWarning(String(w.message))) onShadow()
  }
  process.on("warning", on)
  return () => process.off("warning", on)
}
