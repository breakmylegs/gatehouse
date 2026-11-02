import { useEffect, useRef } from "react"
import Markdown from "react-markdown"
import { PAGE_HELP } from "../help/content"
import { useStore } from "../store"

/** Help for the page you are on, in a pane on the right, so reading it never takes you away from the work. */
export function HelpPane() {
  const open = useStore((s) => s.helpOpen)
  const route = useStore((s) => s.route)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const setRoute = useStore((s) => s.setRoute)
  const heading = useRef<HTMLHeadingElement>(null)
  const article = PAGE_HELP[route === "guide" ? "approvals" : route]

  useEffect(() => {
    if (open) heading.current?.focus()
  }, [open, route])

  if (!open || route === "guide") return null
  return (
    <aside
      aria-label="Help for this page"
      className="help-pane grid min-h-0 grid-rows-[auto_1fr_auto] border-l border-line bg-s1"
      onKeyDown={(e) => {
        if (e.key === "Escape") setHelpOpen(false)
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 ref={heading} tabIndex={-1} className="m-0 text-[18px] outline-none">
          Help: {article.title}
        </h2>
        <button className="btn ml-auto" onClick={() => setHelpOpen(false)}>
          Close
        </button>
      </div>
      <div className="help-body min-h-0 overflow-auto px-4 py-3">
        <Markdown>{article.body}</Markdown>
      </div>
      <div className="border-t border-line px-4 py-3">
        <button
          className="btn w-full justify-center"
          onClick={() => {
            setHelpOpen(false)
            setRoute("guide")
          }}
        >
          Open the full user guide
        </button>
        <p className="m-0 mt-2 text-xs text-mut">F1 opens and closes this pane. Esc closes it.</p>
      </div>
    </aside>
  )
}
