import { useEffect, useState } from "react"
import { api } from "../lib/api"

export interface GivenEntry {
  id: string
  scope: string
  topic: string
  text: string
}

/** What this chat was told it remembers, by the time it started: asked for when the panel opens. */
export function useMemoryGiven(sessionId: string, on: boolean): GivenEntry[] | undefined {
  const [given, setGiven] = useState<GivenEntry[]>()
  useEffect(() => {
    if (!on) return
    let live = true
    void api<{ entries: GivenEntry[] }>(
      "GET",
      `/api/memory/given?session=${encodeURIComponent(sessionId)}`,
    ).then((r) => {
      if (live) setGiven(r.ok && r.data ? r.data.entries : [])
    })
    return () => {
      live = false
    }
  }, [sessionId, on])
  return given
}

/**
 * Exactly what Claude was told it remembers when this chat started (the owner's Chat build, CH-03): every entry in
 * the words it was given, with the project or all chats it came from. Memory changed since reaches the next chat.
 */
export function MemoryGiven({ entries }: { entries: GivenEntry[] | undefined }) {
  if (entries === undefined) return <p className="m-0 text-mut">Loading…</p>
  if (entries.length === 0)
    return (
      <p className="m-0 text-mut">
        Claude was told nothing from memory when this chat started. What chats remember is in
        Memory, where you can add to it.
      </p>
    )
  return (
    <div className="grid gap-3">
      <p className="m-0 text-[13px] text-mut">
        Exactly what Claude was told it remembers when this chat started. Changes in Memory reach
        the next chat.
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {entries.map((e) => (
          <li key={e.id} className="rounded-md border border-line px-3 py-2">
            <span className="block text-[12px] text-mut">
              {e.topic} · {e.scope === "global" ? "every chat" : e.scope}
            </span>
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
