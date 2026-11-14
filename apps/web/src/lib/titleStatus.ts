/**
 * T-057 (t3code review, O31): what a screen reader is told, and an optional word at the start of the window title.
 * The title never names a command, a file or a project: anyone who can see the taskbar can read it.
 */
export type Announce = "all" | "requests" | "off"

export type TitleStatus = "Needs you" | "Working" | undefined

/** "Needs you" when a request waits on you, "Working" while a session runs, otherwise nothing. */
export function titleStatus(
  sessions: ReadonlyArray<{ state: string }>,
  pendingCount: number,
): TitleStatus {
  if (pendingCount > 0) return "Needs you"
  if (sessions.some((s) => s.state === "waiting")) return "Needs you"
  if (sessions.some((s) => s.state === "running" || s.state === "starting")) return "Working"
  return undefined
}

/** The title with the status in front, or as it was; an earlier status is taken off first. */
export function withStatus(title: string, status: TitleStatus): string {
  const bare = title.replace(/^(Needs you|Working) · /, "")
  return status ? `${status} · ${bare}` : bare
}
