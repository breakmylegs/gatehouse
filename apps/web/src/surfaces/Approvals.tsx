import { useEffect, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ApprovalCard } from "../components/ApprovalCard"
import { RiskBadge } from "../components/RiskBadge"
import { SessionCode } from "../components/SessionCode"
import { age } from "../lib/format"
import { useNow } from "../lib/useNow"
import { usePending, useStore } from "../store"

export function Approvals() {
  const pending = usePending()
  const sessions = useStore((s) => s.sessions)
  const selected = useStore((s) => s.selectedRequest)
  const select = useStore((s) => s.selectRequest)
  const resolved = useStore((s) => s.resolved)
  const card = useRef<HTMLDivElement>(null)
  const list = useRef<VirtuosoHandle>(null)
  const now = useNow()
  const seen = useStore((s) => s.seen)
  const markSeen = useStore((s) => s.markSeen)

  const current =
    (selected ? pending.find((p) => p.request.id === selected) : undefined) ?? pending[0]
  const justResolved = selected && !current ? resolved[selected]?.view : undefined
  const view = current ?? justResolved
  const currentIndex = current ? pending.findIndex((p) => p.request.id === current.request.id) : -1

  // The request on the pass has been seen: its line on the board stops being lit.
  useEffect(() => {
    if (current) markSeen(current.request.id)
  }, [current, markSeen])

  // Keep the chosen request on screen when it changes, from the keyboard or because the last one was decided.
  useEffect(() => {
    if (currentIndex >= 0) list.current?.scrollIntoView({ index: currentIndex, behavior: "auto" })
  }, [currentIndex])

  // Ctrl+Shift+A moves focus into the card on purpose. Nothing else ever does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault()
        card.current?.querySelector<HTMLElement>("[data-approval-card]")?.focus()
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && pending.length) {
        e.preventDefault()
        // No wrap-around: at 300 requests, jumping from the last to the first would lose your place.
        const next = pending[currentIndex + (e.key === "ArrowDown" ? 1 : -1)]
        if (next) select(next.request.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pending, currentIndex, select])

  const recent = Object.values(resolved)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)

  return (
    <div className="grid h-full grid-cols-[360px_1fr] max-[1000px]:grid-cols-1 max-[1000px]:grid-rows-[minmax(0,240px)_1fr]">
      <h1 className="sr-only">Approvals</h1>
      <section
        aria-label="Queue"
        className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] border-r border-line bg-s1 max-[1000px]:border-b max-[1000px]:border-r-0"
      >
        <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 pb-2.5 pt-4">
          <h2 className="m-0 text-[19px]">Waiting on you</h2>
          <span className="sign text-[13px] font-normal text-mut">
            {pending.length} waiting, oldest first
          </span>
        </div>
        <div
          aria-hidden="true"
          className={pending.length > 0 ? "board-head grid-cols-[54px_minmax(0,1fr)]" : ""}
        >
          {pending.length > 0 ? (
            <>
              <span>Waiting</span>
              <span>Session and request</span>
            </>
          ) : null}
        </div>
        {pending.length === 0 ? (
          <div className="px-4 py-2">
            <p className="m-0 text-mut">
              Nothing is waiting. Automatic decisions are going through.
            </p>
          </div>
        ) : (
          <Virtuoso
            ref={list}
            style={{ height: "100%" }}
            data={pending}
            computeItemKey={(_, p) => p.request.id}
            itemContent={(_, p) => (
              <button
                className="board-row grid-cols-[auto_minmax(0,1fr)]"
                data-lit={
                  !seen[p.request.id] && p.request.id !== current?.request.id ? "" : undefined
                }
                aria-current={p.request.id === current?.request.id ? "true" : undefined}
                onClick={() => select(p.request.id)}
              >
                <span className="board-time">{age(p.request.createdAt, now)}</span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    {sessions[p.request.sessionId] ? (
                      <SessionCode session={sessions[p.request.sessionId]!} />
                    ) : null}
                    <span className="truncate text-[13px] text-mut">{p.request.project}</span>
                  </span>
                  <span className="block truncate text-[15px] font-semibold">
                    {p.request.kind === "question"
                      ? "Question from Claude"
                      : p.request.kind === "plan"
                        ? "Plan to approve"
                        : p.request.toolName === "Bash" || p.request.toolName === "PowerShell"
                          ? "Run shell command"
                          : p.request.toolName}
                  </span>
                  <RiskBadge risk={p.request.verdict.risk} className="w-fit text-[12.5px]" />
                </span>
              </button>
            )}
          />
        )}
        {recent.length > 0 ? (
          <div className="max-h-40 overflow-auto border-t border-line px-4 py-2">
            <h2 className="m-0 mb-1 text-[14px] text-mut">Just decided</h2>
            <ul className="m-0 list-none p-0">
              {recent.map((r) => (
                <li key={r.id} className="py-0.5 text-[13px] text-mut">
                  {sessions[r.sessionId]?.project ?? "Session"}: {r.summary}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div />
        )}
      </section>
      <section
        ref={card}
        aria-label="Selected request"
        className="min-h-0 min-w-0 overflow-auto p-6"
      >
        {view ? (
          <div className="mx-auto max-w-[1100px]">
            <ApprovalCard view={view} />
            <p className="mt-3 text-[13px] text-mut">
              <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> moves focus to the card. <kbd>Alt</kbd>+
              <kbd>Up</kbd> and <kbd>Alt</kbd>+<kbd>Down</kbd> change request. <kbd>Ctrl</kbd>+
              <kbd>K</kbd> opens the palette.
            </p>
          </div>
        ) : (
          <div className="mx-auto mt-20 grid max-w-md justify-items-center gap-2 text-center">
            <span className="board-time !h-10 px-4 text-[18px]">0 waiting</span>
            <h2 className="m-0 text-[24px]">All clear</h2>
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
