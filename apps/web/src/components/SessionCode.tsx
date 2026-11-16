import clsx from "clsx"
import { sessionRibbon } from "../lib/codes"

/**
 * A session's ribbon colour, shown wherever the session is named. Owner, 16 Nov (O38): "The sessions identifiers add no
 * value on the GUI. These should be removed", so its code (such as DC 823) is no longer shown; the name beside it says
 * which session it is. The code still works where you type it (@session).
 */
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
      aria-hidden="true"
    >
      <i />
    </span>
  )
}
