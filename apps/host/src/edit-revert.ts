import path from "node:path"

/**
 * T-042 (t3code review, O31): Edit from here can put the session's files back as they were when you sent that
 * message. Only in a session that works in its own worktree, and never when another open session works in the same
 * folder, one inside it or one around it, since the files would change under it too.
 */
export const EDIT_REVERT_RULE = "edit-revert"

/** Whether two folders are the same, or one is inside the other. Windows and the Mac compare without case. */
export function sharesFolder(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const fold = platform === "win32" || platform === "darwin"
  const norm = (p: string) => {
    const r = (platform === "win32" ? path.win32 : path.posix).resolve(p)
    return fold ? r.toLowerCase() : r
  }
  const sep = platform === "win32" ? "\\" : "/"
  const x = norm(a)
  const y = norm(b)
  const within = (inner: string, outer: string) =>
    inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep)
  return within(x, y) || within(y, x)
}

/** Why files cannot be put back for this session, or undefined when they can. */
export function cannotRevert(
  me: { id: string; cwd: string; worktree?: unknown },
  open: ReadonlyArray<{ id: string; cwd: string; state: string; title?: string; project: string }>,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!me.worktree) return "Files are put back only for a session that works in its own worktree."
  const other = open.find((o) => o.id !== me.id && o.state !== "ended" && sharesFolder(o.cwd, me.cwd, platform))
  if (other)
    return `Another open session works in this folder (${other.title ?? other.project}), so the files were not put back.`
  return undefined
}
