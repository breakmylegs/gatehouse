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

export const ALLOWED_MODES = ["default", "plan"] as const
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
 *  3  the mode is set, and is default or plan, with no bypass or auto mode or equivalent;
 *  4  allowedTools has no bare tool names (they would approve calls before canUseTool sees them);
 *  5  nothing else supplies permissions (settings, a prompt tool, extra CLI flags, agent modes);
 *  6  the environment is given explicitly and holds no credentials, and the binary is the bundled one.
 * It also requires that canUseTool and the PreToolUse floor hook are present.
 */
export function assertSafeOptions(options: Options): void {
  if (options.permissionMode === undefined) {
    throw new SafetyError(3, "the permission mode must be set explicitly on every session")
  }
  if (!isAllowedMode(options.permissionMode)) {
    throw new SafetyError(
      3,
      `permission mode "${String(options.permissionMode)}" is not allowed, only default and plan`,
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
  if (options.settings !== undefined) {
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
    throw new SafetyError(1, "canUseTool must be set so every prompt reaches JCVC")
  }
  if ((options.hooks?.PreToolUse?.length ?? 0) === 0) {
    throw new SafetyError(2, "the PreToolUse floor hook must be registered")
  }
}

const SHADOWED =
  /CLAUDE_SDK_CAN_USE_TOOL_SHADOWED|canUseTool[^\n]{0,80}\b(shadow|never (be )?called|bypass)/i

/**
 * Invariant 4: a warning that canUseTool is being shadowed (some rule approves calls before it is asked)
 * is fatal. The installed SDK does not contain the string, so this also matches the likely wording.
 */
export function isShadowWarning(text: string): boolean {
  return SHADOWED.test(text)
}
