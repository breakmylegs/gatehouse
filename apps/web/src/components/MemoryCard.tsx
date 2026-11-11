import { useEffect, useState } from "react"
import { toast } from "sonner"
import { onMac } from "../lib/platform-mac" // Mac fork
import { send } from "../store"

/**
 * C-004: Codehouse refused to start something because this computer's memory is committed past the point in
 * Settings. The card says how far, and offers the idle sessions to suspend; each one can be started again later on the
 * same conversation.
 */

interface Status {
  reading?: { commitUsed: number; commitLimit: number }
  percent?: number
  point?: number
  over: boolean
  idle: Array<{ id: string; title: string; project: string }>
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`

export function MemoryCard({ onRetry }: { onRetry?: () => void }) {
  const [st, setSt] = useState<Status>()
  const [busy, setBusy] = useState<string>()
  const load = () =>
    void send({ type: "memory_status" }).then((r) => {
      if (r.ok && r.data) setSt(r.data as Status)
    })
  useEffect(load, [])
  return (
    <div role="alert" className="grid gap-2 rounded-md border border-warn bg-s1 p-3 text-[14px]">
      <strong>Not started: this computer is short of memory</strong>
      <p className="m-0">
        {st?.reading && st.percent !== undefined
          ? // Mac fork: a Mac's reading is a share out of 100, not bytes (memory-governor-mac.ts).
            onMac(`Memory is ${st.percent}% committed (${gb(st.reading.commitUsed)} of ${gb(st.reading.commitLimit)}), over the ${st.point ?? 85}% set in Settings, Sessions, Memory. `, `Memory is ${st.percent}% in use, over the ${st.point ?? 85}% set in Settings, Sessions, Memory. `)
          : onMac("Memory is committed past the point set in Settings, Sessions, Memory. ", "Memory in use is past the point set in Settings, Sessions, Memory. ")}
        {onMac("Starting more now could make Windows run out and stop the sessions you have.", "Starting more now could leave macOS short of memory, which slows or stops the sessions you have.")} Suspend one you
        are not using, close other programs, or change the point in Settings.
      </p>
      {st?.idle.length ? (
        <ul className="m-0 grid gap-1 p-0">
          {st.idle.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2" style={{ listStyle: "none" }}>
              <span className="min-w-0 truncate">
                {s.title} <span className="text-mut">({s.project}), idle</span>
              </span>
              <button
                type="button"
                className="btn !min-h-7 !text-[13px]"
                disabled={busy !== undefined}
                onClick={() => {
                  setBusy(s.id)
                  void send({ type: "suspend_session", sessionId: s.id }).then((r) => {
                    setBusy(undefined)
                    if (!r.ok) toast.error(r.error?.message ?? "It could not be suspended")
                    else toast(`${s.title} is suspended. Start again brings it back.`)
                    load()
                  })
                }}
              >
                {busy === s.id ? "Suspending" : "Suspend"}
              </button>
            </li>
          ))}
        </ul>
      ) : st ? (
        <p className="m-0 text-mut">No session is idle to suspend.</p>
      ) : null}
      {onRetry ? (
        <div>
          <button type="button" className="btn btn-primary !min-h-7" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}
