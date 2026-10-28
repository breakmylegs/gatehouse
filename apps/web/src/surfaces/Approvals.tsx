import clsx from "clsx"
import { JcvcArt } from "../components/JcvcArt"
import { useEffect, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ApprovalCard } from "../components/ApprovalCard"
import { RiskBadge } from "../components/RiskBadge"
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

  const current =
    (selected ? pending.find((p) => p.request.id === selected) : undefined) ?? pending[0]
  const justResolved = selected && !current ? resolved[selected]?.view : undefined
  const view = current ?? justResolved
  const currentIndex = current ? pending.findIndex((p) => p.request.id === current.request.id) : -1

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
    <div className="grid h-full grid-cols-[290px_1fr] max-[1000px]:grid-cols-1 max-[1000px]:grid-rows-[minmax(0,240px)_1fr]">
      <h1 className="sr-only">Approvals</h1>
      <section
        aria-label="Queue"
        className="grid min-h-0 grid-rows-[auto_1fr_auto] border-r border-line bg-s1 max-[1000px]:border-b max-[1000px]:border-r-0"
      >
        <h2 className="m-0 px-4 pb-1 pt-3 text-[13px] font-semibold text-mut">
          Waiting on you ({pending.length}), oldest first
        </h2>
        {pending.length === 0 ? (
          <div className="px-4 py-2">
            <p className="m-0 text-mut">
              Nothing is waiting. Automatic decisions are going through.
            </p>
            <JcvcArt which="soldier" />
          </div>
        ) : (
          <Virtuoso
            ref={list}
            style={{ height: "100%" }}
            data={pending}
            computeItemKey={(_, p) => p.request.id}
            itemContent={(_, p) => (
              <button
                className={clsx(
                  "block w-full border-0 border-l-[3px] border-transparent bg-transparent px-3 py-1.5 text-left hover:bg-s2",
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
                      : p.request.toolName === "Bash" || p.request.toolName === "PowerShell"
                        ? "Run shell command"
                        : p.request.toolName}
                </span>
                <span className="block truncate text-[13px] text-mut">
                  {p.request.project} · {age(p.request.createdAt, now)}
                </span>
                <RiskBadge risk={p.request.verdict.risk} className="mt-0.5 text-[13px]" />
              </button>
            )}
          />
        )}
        {recent.length > 0 ? (
          <div className="max-h-40 overflow-auto border-t border-line px-4 py-2">
            <h2 className="m-0 mb-1 text-[13px] font-semibold text-mut">Just decided</h2>
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
          <div className="mx-auto mt-16 max-w-md text-center">
            <h2 className="m-0 text-[17px] font-semibold">All clear</h2>
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
