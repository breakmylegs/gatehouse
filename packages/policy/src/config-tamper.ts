/**
 * D-060, the agent-config tamper floor (Frontier build, Wave 1). An agent that can change what an AI tool may do
 * without asking can let itself, or the next agent, do anything. So the floor denies, in every mode and whatever any
 * rule says, an agent's write that changes:
 *   - permissions or hooks in .claude/settings*.json,
 *   - keys with autoApprove or chat.tools in .vscode/settings.json,
 *   - Cursor's and Codex's configuration (.cursor, .codex),
 *   - Codehouse's own data folder and the managed policy folder.
 * The owner edits these by hand.
 */
import path from "node:path"
import type { FloorHit } from "./floor.js"
import type { Segment } from "./segments.js"
import type { ToolCall } from "./types.js"

export const TAMPER_RULE = "agent-config-tamper"
const MESSAGE =
  "Settings that decide what an AI tool may do without asking are changed by the person, by hand, never by a session. Ask the person to make this change."

const slash = (p: string) => p.replace(/\\/g, "/").toLowerCase()

/** Folders no session writes in, wherever they are. */
const WHOLE = [
  /(^|\/)\.cursor(\/|$)/,
  /(^|\/)\.codex(\/|$)/,
  /(^|\/)appdata\/local\/gatehouse(\/|$)/,
  /(^|\/)programdata\/(codehouse|gatehouse)(\/|$)/,
]
const CLAUDE_SETTINGS = /(^|\/)\.claude\/settings[^/]*\.json$/
const VSCODE_SETTINGS = /(^|\/)\.vscode\/settings\.json$/

/** What, in each settings file, decides what a tool may do without asking. */
const CLAUDE_KEYS = /"(permissions|hooks|defaultMode|allow|deny|ask|additionalDirectories|disableBypassPermissionsMode|enableAllProjectMcpServers|enabledMcpjsonServers|disabledMcpjsonServers|apiKeyHelper)"/
const VSCODE_KEYS = /autoApprove|chat\.tools|chat\.agent|copilot\.chat\.agent|"chat\.mcp/i

function hit(why: string): FloorHit {
  return { outcome: "deny", ruleId: TAMPER_RULE, reason: `${MESSAGE} (${why})` }
}

/** The JSON's values for these keys, top level, as text: a Write changes them when the text differs. */
function keysOf(text: string, keys: RegExp): string | undefined {
  try {
    const j = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>
    return JSON.stringify(Object.entries(j).filter(([k]) => keys.test(`"${k}"`) || keys.test(k)))
  } catch {
    return undefined
  }
}

/** A file tool's change to one of the guarded files, or null. `current` reads the file as it is, for a Write. */
export function configTamperFile(call: ToolCall, cwd: string, current: (f: string) => string | undefined): FloorHit | null {
  const i = (call.input ?? {}) as Record<string, unknown>
  const raw = typeof i.file_path === "string" ? i.file_path : typeof i.notebook_path === "string" ? i.notebook_path : undefined
  if (!raw || !["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(call.toolName)) return null
  const p = slash(path.resolve(cwd, raw))
  if (WHOLE.some((r) => r.test(p))) return hit(`it writes in ${raw}`)
  const keys = CLAUDE_SETTINGS.test(p) ? CLAUDE_KEYS : VSCODE_SETTINGS.test(p) ? VSCODE_KEYS : undefined
  if (!keys) return null
  if (call.toolName === "Write") {
    const after = typeof i.content === "string" ? i.content : ""
    const before = current(path.resolve(cwd, raw)) ?? "{}"
    const a = keysOf(after, keys)
    // A settings file that cannot be read as JSON cannot be shown to leave them alone.
    if (a === undefined || a !== keysOf(before, keys)) return hit(`it changes what ${path.basename(raw)} lets a tool do`)
    return null
  }
  const parts: string[] =
    call.toolName === "MultiEdit" && Array.isArray(i.edits)
      ? (i.edits as Array<{ old_string?: unknown; new_string?: unknown }>).flatMap((e) => [String(e.old_string ?? ""), String(e.new_string ?? "")])
      : [String(i.old_string ?? ""), String(i.new_string ?? "")]
  return parts.some((s) => keys.test(s)) ? hit(`it changes what ${path.basename(raw)} lets a tool do`) : null
}

const SHELL_EDITORS = /^(set-content|add-content|out-file|clear-content|tee|truncate|remove-item|rm|del|erase)$/i
/** Copy and move write only to their last argument. */
const COPIERS = /^(cp|mv|copy|move|copy-item|move-item|xcopy|robocopy)$/i

/** A shell command that writes to one of the guarded files or folders. */
export function configTamperShell(segments: Segment[], cwd: string): FloorHit | null {
  const guarded = (a: string) => {
    const p = slash(path.resolve(cwd, a.replace(/^\d?>>?/, "")))
    return WHOLE.some((r) => r.test(p)) || CLAUDE_SETTINGS.test(p) || VSCODE_SETTINGS.test(p)
  }
  for (const s of segments) {
    const plain = s.args.filter((a) => !a.startsWith("-"))
    const targets = COPIERS.test(s.name) ? plain.slice(-1).filter(guarded) : s.args.filter(guarded)
    if (!targets.length) continue
    const writes =
      COPIERS.test(s.name) ||
      SHELL_EDITORS.test(s.name) ||
      s.writes ||
      ((s.name === "sed" || s.name === "perl") && s.args.some((a) => /^-[a-z]*i/.test(a)))
    if (writes) return hit(`it writes to ${targets[0]} from the shell`)
  }
  return null
}
