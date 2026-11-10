import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useStore } from "../store"

/** A card on the task board (apps/host/src/board.ts). */
export interface Card {
  id: string
  title: string
  prompt: string
  folder: string
  column: Column
  sessionId?: string
  createdAt: string
}

type Column = "todo" | "running" | "review" | "done"

export const COLUMNS: Array<[Column, string]> = [
  ["todo", "To do"],
  ["running", "Running"],
  ["review", "Review"],
  ["done", "Done"],
]
const label = (c: Column) => COLUMNS.find(([id]) => id === c)![1]

/** Where a picked-up card would go, before it is dropped. */
interface Lifted {
  id: string
  column: Column
  index: number
}

/** The cards of one column in order, with a picked-up card shown where it would go. */
export function columnCards(cards: Card[], column: Column, lifted?: Lifted): Card[] {
  const card = lifted && cards.find((c) => c.id === lifted.id)
  const rest = cards.filter((c) => c.column === column && c.id !== lifted?.id)
  if (!card || !lifted || lifted.column !== column) return rest
  const at = Math.max(0, Math.min(lifted.index, rest.length))
  return [...rest.slice(0, at), card, ...rest.slice(at)]
}

/**
 * The task board (backlog G24): cards across sessions in To do, Running, Review and Done. A card moved to Running
 * starts its session in its folder with its prompt (recorded, and through every check a session you start goes
 * through). Drag a card, or with the keyboard: Space picks it up, the arrow keys choose its column and place, Space
 * drops it and Esc puts it back; each step is said. Nothing moves until it is dropped, so passing through Running
 * starts nothing. The board is kept by Codehouse and survives a restart.
 */
export function Board() {
  const [cards, setCards] = useState<Card[]>()
  const [lifted, setLifted] = useState<Lifted>()
  const [said, setSaid] = useState("")
  const [draft, setDraft] = useState({ title: "", folder: "", prompt: "" })
  const sessions = useStore((s) => s.sessions)
  const selectSession = useStore((s) => s.selectSession)
  const setRoute = useStore((s) => s.setRoute)

  const load = useCallback(async () => {
    const r = await api<{ cards: Card[] }>("GET", "/api/board")
    setCards(r.ok && r.data ? r.data.cards : [])
  }, [])
  useEffect(() => void load(), [load])
  // A picked-up card drawn in another column is a new element: focus stays on it, so the keys keep working.
  useEffect(() => {
    if (lifted)
      document.querySelector<HTMLElement>(`[data-card="${CSS.escape(lifted.id)}"]`)?.focus()
  }, [lifted])

  async function move(card: Card, column: Column, index?: number) {
    const r = await api<{ card: Card }>("POST", "/api/board/move", {
      id: card.id,
      column,
      ...(index !== undefined ? { index } : {}),
    })
    if (!r.ok || !r.data) {
      setSaid(`${card.title} was not moved.`)
      toast.error(r.error ?? "The card was not moved", { id: "board" })
      await load()
      return
    }
    const started = !card.sessionId && r.data.card.sessionId
    setSaid(`${card.title} moved to ${label(column)}${started ? ", and its session started" : ""}.`)
    await load()
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const r = await api("PUT", "/api/board/cards", draft)
    if (!r.ok) return toast.error(r.error ?? "The card was not added", { id: "board" })
    setDraft({ ...draft, title: "", prompt: "" })
    void load()
  }

  async function remove(card: Card) {
    const r = await api("DELETE", `/api/board/cards/${encodeURIComponent(card.id)}`)
    if (!r.ok) return toast.error(r.error ?? "Not removed", { id: "board" })
    setSaid(`${card.title} removed.`)
    void load()
  }

  function onKey(e: React.KeyboardEvent, card: Card) {
    if (!cards) return
    if (e.key === " ") {
      e.preventDefault()
      if (!lifted) {
        const index = columnCards(cards, card.column).findIndex((c) => c.id === card.id)
        setLifted({ id: card.id, column: card.column, index })
        setSaid(
          `Picked up ${card.title}, in ${label(card.column)}. Left and right choose a column, up and down its place; Space drops it, Escape puts it back.`,
        )
      } else if (lifted.id === card.id) {
        const to = lifted
        setLifted(undefined)
        if (
          to.column === card.column &&
          to.index === columnCards(cards, card.column).findIndex((c) => c.id === card.id)
        )
          setSaid(`${card.title} dropped where it was.`)
        else void move(card, to.column, to.index)
      }
      return
    }
    if (!lifted || lifted.id !== card.id) return
    if (e.key === "Escape") {
      e.preventDefault()
      setLifted(undefined)
      setSaid(`${card.title} put back in ${label(card.column)}.`)
      return
    }
    const col = COLUMNS.findIndex(([id]) => id === lifted.column)
    let next = lifted
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const to = COLUMNS[col + (e.key === "ArrowLeft" ? -1 : 1)]?.[0]
      if (!to) return
      next = { ...lifted, column: to, index: columnCards(cards, to).length }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const size = columnCards(cards, lifted.column, lifted).length
      const index = Math.max(0, Math.min(size - 1, lifted.index + (e.key === "ArrowUp" ? -1 : 1)))
      next = { ...lifted, index }
    } else return
    e.preventDefault()
    setLifted(next)
    const size = columnCards(cards, next.column, next).length
    setSaid(`${card.title}: ${label(next.column)}, place ${next.index + 1} of ${size}.`)
  }

  return (
    <div className="mx-auto grid max-w-[1200px] gap-4 p-6">
      <header>
        <h1 className="m-0">Board</h1>
        <p className="m-0 mt-1 max-w-[70ch] text-mut">
          Cards for work across sessions. Moving a card to Running starts its session in its folder
          with its prompt. Drag a card, or press Space on it, choose a column with the arrow keys
          and press Space again.
        </p>
      </header>
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
        {COLUMNS.map(([column, name]) => {
          const list = cards ? columnCards(cards, column, lifted) : []
          return (
            <section
              key={column}
              aria-label={name}
              className="panel grid content-start gap-2 p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const card = cards?.find((c) => c.id === e.dataTransfer.getData("text/x-card"))
                if (card && card.column !== column) void move(card, column)
              }}
            >
              <h2 className="m-0 px-1 text-[15px]">
                {name} <span className="text-mut">{list.length}</span>
              </h2>
              <ul className="m-0 grid min-h-12 list-none gap-2 p-0">
                {list.map((card) => {
                  const session = card.sessionId ? sessions[card.sessionId] : undefined
                  return (
                    <li
                      key={card.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/x-card", card.id)}
                      className="panel grid gap-1 bg-s1 p-2 text-[13.5px]"
                      data-lifted={lifted?.id === card.id ? "" : undefined}
                    >
                      <button
                        type="button"
                        className="cursor-grab border-0 bg-transparent p-0 text-left font-semibold"
                        aria-roledescription="card"
                        data-card={card.id}
                        aria-pressed={lifted?.id === card.id}
                        aria-label={`${card.title}, in ${name}`}
                        onKeyDown={(e) => onKey(e, card)}
                      >
                        {card.title}
                      </button>
                      {card.folder ? (
                        <span className="mono truncate text-[12px] text-mut">{card.folder}</span>
                      ) : null}
                      {card.sessionId ? (
                        <span className="flex items-center gap-2 text-[12.5px]">
                          <span className="text-mut">
                            {session ? session.state : "session closed"}
                          </span>
                          {session ? (
                            <button
                              type="button"
                              className="btn !min-h-6 !px-2 !text-[12px]"
                              aria-label={`Open the session of ${card.title}`}
                              onClick={() => {
                                selectSession(card.sessionId!)
                                setRoute("workspace")
                              }}
                            >
                              Open
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[12px] text-mut underline"
                        aria-label={`Remove ${card.title}`}
                        onClick={() => void remove(card)}
                      >
                        Remove
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
      <form className="panel grid gap-2 p-3" aria-label="Add a card" onSubmit={(e) => void add(e)}>
        <h2 className="m-0 text-[15px]">Add a card</h2>
        <div className="grid grid-cols-2 gap-2 max-[700px]:grid-cols-1">
          <label className="grid gap-1 text-sm">
            <span>Title</span>
            <input
              className="field"
              maxLength={120}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Folder</span>
            <input
              className="field mono"
              placeholder="C:\dev\shop"
              value={draft.folder}
              onChange={(e) => setDraft({ ...draft, folder: e.target.value })}
            />
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          <span>Prompt (what its session is asked to do)</span>
          <textarea
            className="field"
            rows={2}
            maxLength={8000}
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
        </label>
        <div>
          <button className="btn btn-primary" disabled={!draft.title.trim()}>
            Add to To do
          </button>
        </div>
      </form>
    </div>
  )
}
