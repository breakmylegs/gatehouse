import clsx from "clsx"
import { useEffect, useRef, useState } from "react"
import { copyText } from "../lib/copy"
import { Icon } from "./Icon"

/**
 * A small Copy button that says Copied for a moment (owner, 1 Nov). The text can be worked out when it is pressed,
 * for things that are long or change (a whole conversation, what a message rendered as).
 */
export function CopyButton({
  text,
  html,
  what,
  label = "Copy",
  className,
}: {
  text: string | (() => string)
  html?: () => string | undefined
  /** What is copied, for a screen reader: "Copy {what}". */
  what?: string
  label?: string
  className?: string
}) {
  const [done, setDone] = useState<"copied" | "failed">()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <>
      <button
        type="button"
        className={clsx("copy-btn", done === "copied" && "is-done", className)}
        aria-label={what ? `Copy ${what}` : label}
        onClick={(e) => {
          // Inside a summary it copies without opening or closing it.
          e.preventDefault()
          e.stopPropagation()
          void copyText(typeof text === "function" ? text() : text, html?.()).then((ok) => {
            setDone(ok ? "copied" : "failed")
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setDone(undefined), 1600)
          })
        }}
      >
        <Icon name={done === "copied" ? "done" : "copy"} size={14} className="copy-icon" />
        {done === "copied" ? "Copied" : done === "failed" ? "Could not copy" : label}
      </button>
      <span role="status" className="sr-only">
        {done === "copied" ? "Copied" : done === "failed" ? "Could not copy" : ""}
      </span>
    </>
  )
}
