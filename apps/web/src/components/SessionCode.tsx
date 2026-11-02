import clsx from "clsx"
import { sessionCode, sessionRibbon } from "../lib/codes"

/** A session's code and ribbon colour, shown wherever the session is named. */
export function SessionCode({
  session,
  className,
}: {
  session: { id: string; project: string }
  className?: string
}) {
  return (
    <span
      className={clsx("code", className)}
      style={{ ["--ribbon" as string]: sessionRibbon(session) }}
    >
      <i aria-hidden="true" />
      {sessionCode(session)}
    </span>
  )
}
