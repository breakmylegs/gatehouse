/**
 * Which of Claude's edits made one change in a file (backlog G13), so the Changes pane can show the decision that
 * allowed it. A change is matched by its text: the latest Edit, Write, MultiEdit or NotebookEdit on that file whose
 * new text and the change's added lines hold one another (or, for a change that only removes, its old text and the
 * removed lines). No match means the change came another way: a command, a tool Codehouse cannot read, or you.
 */

/** A tool call as the transcript keeps it. */
export interface EditCall {
  toolUseId: string
  name: string
  input: Record<string, unknown>
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

/** A path as a session sees it: absolute, or relative to its folder. */
function absolute(p: string, cwd: string): string {
  return /^([a-z]:)?[\\/]/i.test(p) ? p : `${cwd.replace(/[\\/]+$/, "")}/${p}`
}

/** The edit tool calls on one file, oldest first. `file` may be relative to the session's folder. */
export function editsOn(items: readonly unknown[], file: string, cwd: string): EditCall[] {
  const want = norm(absolute(file, cwd))
  const out: EditCall[] = []
  for (const it of items) {
    const t = it as {
      kind?: unknown
      name?: unknown
      toolUseId?: unknown
      input?: unknown
      subagent?: unknown
    }
    if (t.kind !== "tool" || typeof t.name !== "string" || !EDIT_TOOLS.has(t.name)) continue
    const input = (t.input ?? {}) as Record<string, unknown>
    const p = input.file_path ?? input.notebook_path
    if (typeof p === "string" && norm(absolute(p, cwd)) === want)
      out.push({ toolUseId: String(t.toolUseId), name: t.name, input })
  }
  return out
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

function texts(call: EditCall, side: "new" | "old"): string[] {
  const i = call.input
  if (side === "new") {
    const edits = Array.isArray(i.edits)
      ? (i.edits as Array<Record<string, unknown>>).map((e) => str(e.new_string))
      : []
    return [str(i.new_string), str(i.content), str(i.new_source), ...edits].filter(Boolean)
  }
  const edits = Array.isArray(i.edits)
    ? (i.edits as Array<Record<string, unknown>>).map((e) => str(e.old_string))
    : []
  return [str(i.old_string), ...edits].filter(Boolean)
}

/** Lines compared without their surrounding spaces or line endings, blank lines left out. */
const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")

/**
 * The edit that made a change: `added` is the change's text in the file now, `removed` its text before. The latest
 * matching edit wins, as a later edit is the one that left the file as it is.
 */
export function originOf(
  edits: readonly EditCall[],
  added: string,
  removed: string,
): EditCall | undefined {
  const want = lines(added)
  const side = want ? "new" : "old"
  const look = want || lines(removed)
  if (!look) return undefined
  // A change is whole lines; an edit may replace part of a line, so either may hold the other. The part held needs a
  // few characters, or a one-letter change or edit would match everything; a short one must match whole.
  const enough = (s: string) => s.replace(/\s/g, "").length >= 4
  const holds = (t: string) =>
    t === look || (enough(look) && t.includes(look)) || (enough(t) && look.includes(t))
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i]!
    if (texts(e, side).some((t) => holds(lines(t)))) return e
  }
  return undefined
}

/** The text of lines `start` to `start + count - 1` (1-based) of a file. */
export function linesOf(text: string, start: number, count: number): string {
  if (count <= 0) return ""
  return text
    .split("\n")
    .slice(start - 1, start - 1 + count)
    .join("\n")
}
