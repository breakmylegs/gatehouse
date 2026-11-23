import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send, useStore } from "../store"

interface Item {
  urgency: number
  kind: string
  title: string
  why: string
  sessionId?: string
}

/** E-088: this morning's plan, most urgent first; an item with a session opens it. */
export function DailyPlanPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[]>()
  useEffect(() => {
    void send({ type: "daily_plan" }).then((x) => (x.ok ? setItems((x.data as { items: Item[] }).items) : toast.error(x.error?.message ?? "Not made", { id: "plan" })))
  }, [])
  const open = (id: string) => useStore.getState().selectSession(id)
  return (
    <section aria-label="Daily plan" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Today's plan</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      {!items ? (
        <p className="m-0 text-mut">Making the plan…</p>
      ) : !items.length ? (
        <p className="m-0">Nothing needs you this morning.</p>
      ) : (
        <ol className="m-0 grid gap-1.5 pl-5">
          {items.map((i, n) => (
            <li key={`${n}:${i.title}`} className={i.urgency >= 85 ? "font-semibold" : ""}>
              {i.sessionId ? (
                <button type="button" className="link" onClick={() => open(i.sessionId!)}>
                  {i.title}
                </button>
              ) : (
                i.title
              )}
              <span className="block font-normal text-mut">{i.why}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
