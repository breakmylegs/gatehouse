import type { ReactNode } from "react"

/** The spot pictures from the Codehouse visual identity pack, in public/codehouse/empty. */
export const EMPTY_PICTURES = [
  "all-done",
  "empty-approvals",
  "empty-chats",
  "empty-marketplace",
  "empty-memory",
  "empty-projects",
  "empty-search",
  "empty-sessions",
  "offline",
] as const

export type EmptyPicture = (typeof EMPTY_PICTURES)[number]

/**
 * An empty page or list: the pack's picture for it, then what to do next. The picture is decoration (the words say
 * it all), so screen readers skip it.
 */
export function EmptyState({ picture, children }: { picture: EmptyPicture; children: ReactNode }) {
  return (
    <div className="empty-state" data-picture={picture}>
      <img src={`./codehouse/empty/${picture}.png`} alt="" width={240} height={180} />
      {children}
    </div>
  )
}
