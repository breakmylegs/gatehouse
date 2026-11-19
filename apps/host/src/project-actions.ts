import fs from "node:fs"
import path from "node:path"

/**
 * T-091 (t3code review, safe variant): project actions. Yours, kept in Codehouse's settings by project (a name, a
 * command, a kind: setup or run, and a preview address on this computer), run by your click in the terminal pane as
 * if you typed them. A repository's own, in `.codehouse/actions.json`, are someone else's words: shown, and run only
 * as a Codehouse action, judged by the rules and on the approval card like a command of Claude's; never by themselves,
 * not when a worktree is made, not on opening.
 */
export interface ProjectAction {
  name: string
  command: string
  kind: "setup" | "run"
  /** An address on this computer to open once it runs: http://localhost:5173. */
  preview?: string
}

export const REPO_ACTIONS_FILE = ".codehouse/actions.json"
const MAX_ACTIONS = 30

/** A preview address only on this computer. */
export const isLocalPreview = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\s]*)?$/i.test(u)

/** Actions read tolerantly: anything not an action, or too long, is left out. */
export function checkActions(v: unknown): ProjectAction[] {
  if (!Array.isArray(v)) return []
  const out: ProjectAction[] = []
  for (const a of v.slice(0, MAX_ACTIONS)) {
    if (!a || typeof a !== "object") continue
    const o = a as Record<string, unknown>
    const name = typeof o.name === "string" ? o.name.trim() : ""
    const command = typeof o.command === "string" ? o.command.trim() : ""
    if (!name || name.length > 60 || !command || command.length > 2000 || /[\r\n]/.test(command)) continue
    const preview = typeof o.preview === "string" && isLocalPreview(o.preview) ? o.preview : undefined
    out.push({ name, command, kind: o.kind === "setup" ? "setup" : "run", ...(preview ? { preview } : {}) })
  }
  return out
}

/** The repository's own actions, from its `.codehouse/actions.json` ({ "actions": [...] }); none when it has none. */
export function repoActions(root: string): ProjectAction[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, REPO_ACTIONS_FILE), "utf8")) as { actions?: unknown }
    return checkActions(raw?.actions)
  } catch {
    return []
  }
}
