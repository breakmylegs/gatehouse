import clsx from "clsx"
import { useEffect, useRef } from "react"
import { ApprovalCard } from "../components/ApprovalCard"
import { age } from "../lib/format"
import { usePending, useStore } from "../store"

export function Approvals() {
  const pending = usePending()
  const sessions = useStore((s) => s.sessions)
  const selected = useStore((s) => s.selectedRequest)
  const select = useStore((s) => s.selectRequest)
  const resolved = useStore((s) => s.resolved)
  const card = useRef<HTMLDivElement>(null)

  const current =
    (selected ? pending.find((p) => p.request.id === selected) : undefined) ?? pending[0]
  const justResolved = selected && !current ? resolved[selected]?.view : undefined
  const view = current ?? justResolved

  // Ctrl+Shift+A moves focus into the card on purpose. Nothing else ever does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault()
        card.current?.querySelector<HTMLElement>("[data-approval-card]")?.focus()
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && pending.length) {
        e.preventDefault()
        const i = pending.findIndex((p) => p.request.id === current?.request.id)
        const next =
          pending[(i + (e.key === "ArrowDown" ? 1 : -1) + pending.length) % pending.length]
        if (next) select(next.request.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pending, current, select])

  const recent = Object.values(resolved)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)

  return (
    <div className="grid min-h-full grid-cols-[270px_1fr] max-[1000px]:grid-cols-1">
      <section
        aria-label="Queue"
        className="border-r border-line bg-s1 p-2 max-[1000px]:border-b max-[1000px]:border-r-0"
      >
        <h2 className="mx-2 mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-mut">
          Waiting on you ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="mx-2 my-2 text-mut">
            Nothing is waiting. Automatic decisions are going through.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {pending.map((p) => (
              <li key={p.request.id}>
                <button
                  className={clsx(
                    "block w-full border-0 border-l-[3px] border-transparent bg-transparent px-2 py-1.5 text-left hover:bg-s2",
                    p.request.id === current?.request.id && "border-acc bg-s2",
                  )}
                  aria-current={p.request.id === current?.request.id ? "true" : undefined}
                  onClick={() => select(p.request.id)}
                >
                  <span className="block font-semibold">
                    {p.request.kind === "question"
                      ? "Question from Claude"
                      : p.request.kind === "plan"
                        ? "Plan to approve"
                        : p.request.toolName}
                  </span>
                  <span className="block text-xs text-mut [overflow-wrap:anywhere]">
                    {p.request.project} · {age(p.request.createdAt)} · risk {p.request.verdict.risk}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {recent.length > 0 ? (
          <>
            <h2 className="mx-2 mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-mut">
              Just decided
            </h2>
            <ul className="m-0 list-none p-0">
              {recent.map((r) => (
                <li key={r.id} className="px-2 py-1 text-xs text-mut">
                  {sessions[r.sessionId]?.project ?? "Session"}: {r.summary}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      <section ref={card} aria-label="Selected request" className="min-w-0 p-6">
        {view ? (
          <div className="mx-auto max-w-[980px]">
            <ApprovalCard view={view} />
            <p className="mt-3 text-xs text-mut">
              <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> moves focus to the card. <kbd>Alt</kbd>+
              <kbd>Up</kbd> and <kbd>Alt</kbd>+<kbd>Down</kbd> change request.
            </p>
          </div>
        ) : (
          <div className="mx-auto mt-16 max-w-md text-center">
            <h2 className="m-0 text-base font-semibold">All clear</h2>
            <p className="text-mut">
              When a session needs a decision it appears here, and your phone is told at the same
              time.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
