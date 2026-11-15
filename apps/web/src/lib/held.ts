import { create } from "zustand"

/**
 * T-039 (t3code review, O31): messages held until the turn ends. A message sent while Claude works still goes to it
 * at its next step (owner, 30 Oct); one you hold (Alt+Enter) waits in a list instead, where you can edit, remove or
 * send it now. When a turn ends the first held message is sent as an ordinary prompt; a turn you stopped, or one that
 * failed, leaves them waiting until you choose Resume. Kept per session in the window's storage.
 */
export interface Held {
  id: string
  /** What Claude is sent, with its @ references. */
  text: string
}

const KEY = "gatehouse.held"

function load(): Record<string, Held[]> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown
    if (!v || typeof v !== "object") return {}
    const out: Record<string, Held[]> = {}
    for (const [id, list] of Object.entries(v as Record<string, unknown>))
      if (Array.isArray(list))
        out[id] = list.filter(
          (h): h is Held => typeof h?.id === "string" && typeof h?.text === "string" && h.text.length <= 100_000,
        )
    return out
  } catch {
    return {}
  }
}

function save(all: Record<string, Held[]>): void {
  try {
    const kept = Object.fromEntries(Object.entries(all).filter(([, l]) => l.length))
    if (Object.keys(kept).length) localStorage.setItem(KEY, JSON.stringify(kept))
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: the list lasts until the window closes
  }
}

interface HeldState {
  held: Record<string, Held[]>
  /** Sessions whose list waits for Resume, after a turn you stopped or one that failed. */
  paused: Record<string, boolean>
  hold: (sessionId: string, text: string) => void
  remove: (sessionId: string, id: string) => void
  /** Takes the first held message off the list, to send. */
  takeFirst: (sessionId: string) => Held | undefined
  take: (sessionId: string, id: string) => Held | undefined
  setPaused: (sessionId: string, paused: boolean) => void
}

let n = 0
const newId = () => `h${Date.now().toString(36)}${(n++).toString(36)}`

export const useHeld = create<HeldState>((set, get) => {
  const change = (sessionId: string, list: Held[]) => {
    const held = { ...get().held, [sessionId]: list }
    save(held)
    set({ held })
  }
  return {
    held: load(),
    paused: {},
    hold: (sessionId, text) => change(sessionId, [...(get().held[sessionId] ?? []), { id: newId(), text }]),
    remove: (sessionId, id) => change(sessionId, (get().held[sessionId] ?? []).filter((h) => h.id !== id)),
    takeFirst: (sessionId) => {
      const [first, ...rest] = get().held[sessionId] ?? []
      if (first) change(sessionId, rest)
      return first
    },
    take: (sessionId, id) => {
      const list = get().held[sessionId] ?? []
      const h = list.find((x) => x.id === id)
      if (h) change(sessionId, list.filter((x) => x.id !== id))
      return h
    },
    setPaused: (sessionId, paused) => set({ paused: { ...get().paused, [sessionId]: paused } }),
  }
})

/** Whether the turn that just ended was one you stopped or one that failed, which pauses the held list. */
export function endedBadly(items: ReadonlyArray<{ kind: string; isError?: boolean; stopped?: boolean }>): boolean {
  const last = [...items].reverse().find((i) => i.kind === "result")
  return last ? last.isError === true || last.stopped === true : false
}
