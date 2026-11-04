import { Command } from "cmdk"
import { useEffect, useRef, useState } from "react"
import { api } from "../lib/api"
import { type AppCommand, buildCommands, rankCommands } from "../lib/commands"
import { openConversation } from "../lib/redo"
import { readHideEnded } from "../lib/rail"
import { usePending, useSessionList, useStore } from "../store"
import { EmptyState } from "./EmptyState"

/**
 * Ctrl+K: jump to a page, a session or a waiting request, or do what the menus do, all from the one list in
 * `lib/commands.ts`. The page you are on comes first. It only moves you around and changes how Codehouse looks. It has no
 * allow, deny or kill action on purpose: a decision always happens on the card, with its own safeguards.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const back = useRef<HTMLElement | null>(null)
  const route = useStore((s) => s.route)
  const setRoute = useStore((s) => s.setRoute)
  const selectSession = useStore((s) => s.selectSession)
  const selectRequest = useStore((s) => s.selectRequest)
  const theme = useStore((s) => s.theme)
  const themeFollows = useStore((s) => s.themeFollows)
  const setTheme = useStore((s) => s.setTheme)
  const followSystem = useStore((s) => s.followSystem)
  const barFolded = useStore((s) => s.barFolded)
  const setBarFolded = useStore((s) => s.setBarFolded)
  const helpOpen = useStore((s) => s.helpOpen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const sessions = useSessionList()
  const pending = usePending()
  const [query, setQuery] = useState("")
  const hits = useChatSearch(open ? query : "")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Shift+K is the kill switch's question, not the palette.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        back.current = document.activeElement as HTMLElement | null
        setOpen((o) => !o)
      }
    }
    // The sidebar's Search opens it too.
    const fromButton = () => {
      back.current = document.activeElement as HTMLElement | null
      setOpen(true)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("codeh:palette", fromButton)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("codeh:palette", fromButton)
    }
  }, [])

  const close = () => {
    setOpen(false)
    setQuery("")
    back.current?.focus?.()
  }
  const run = (fn: () => void) => () => {
    fn()
    setOpen(false)
    setQuery("")
  }

  if (!open) return null
  const all = rankCommands(
    buildCommands({
      theme,
      themeFollows,
      hideEnded: readHideEnded(),
      barFolded,
      setBarFolded,
      go: setRoute,
      setTheme,
      followSystem,
      toggleHelp: () => setHelpOpen(!helpOpen),
      fire: (event) => window.dispatchEvent(new Event(event)),
    }),
    route,
  )
  const here = all.filter((c) => c.page === route)
  const rest = all.filter((c) => c.page !== route)
  const commandItems = (list: AppCommand[]) =>
    list.map((c) => (
      <Item key={c.id} value={`${c.label} ${c.keywords ?? ""}`} onSelect={run(c.run)} keys={c.keys}>
        {c.label}
      </Item>
    ))
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-start justify-center bg-black/30 pt-[15vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <Command
        label="Command palette"
        aria-label="Command palette"
        role="dialog"
        aria-modal="true"
        className="panel w-[560px] max-w-[92vw] overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            close()
          }
        }}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Go to a page, session or waiting request, or run a command"
          className="field w-full !rounded-none !border-0 !border-b !border-line"
        />
        <Command.List className="max-h-80 overflow-auto p-1">
          <Command.Empty className="text-mut">
            <EmptyState picture="empty-search">
              <p className="m-0">Nothing matches.</p>
            </EmptyState>
          </Command.Empty>
          {pending.length > 0 ? (
            <Command.Group heading="Waiting on you" className="text-[13px] text-mut">
              {pending.slice(0, 50).map((p) => (
                <Item
                  key={p.request.id}
                  value={`request ${p.request.project} ${p.request.toolName} ${p.request.id}`}
                  onSelect={run(() => {
                    selectRequest(p.request.id)
                    setRoute("approvals")
                  })}
                >
                  {p.request.project}:{" "}
                  {p.request.kind === "permission" ? p.request.toolName : p.request.kind} (risk{" "}
                  {p.request.verdict.risk})
                </Item>
              ))}
            </Command.Group>
          ) : null}
          {here.length > 0 ? (
            <Command.Group heading="On this page" className="text-[13px] text-mut">
              {commandItems(here)}
            </Command.Group>
          ) : null}
          <Command.Group heading="Pages" className="text-[13px] text-mut">
            {commandItems(rest.filter((c) => c.group === "Pages"))}
          </Command.Group>
          {sessions.length > 0 ? (
            <Command.Group heading="Sessions" className="text-[13px] text-mut">
              {sessions.slice(0, 50).map((s) => (
                <Item
                  key={s.id}
                  value={`session ${s.project} ${s.cwd}`}
                  onSelect={run(() => {
                    selectSession(s.id)
                    setRoute("workspace")
                  })}
                >
                  {s.project} ({s.state})
                </Item>
              ))}
            </Command.Group>
          ) : null}
          {hits.length > 0 ? (
            // CH-03: what was said in your chats, from Chat's own store. The words you typed are in each value so
            // the list's own filter keeps them.
            <Command.Group heading="In your chats" className="text-[13px] text-mut">
              {hits.map((h) => (
                <Item
                  key={h.messageId}
                  value={`chat-hit ${h.messageId} ${query} ${h.title}`}
                  onSelect={run(() => void openConversation(h.conversationId))}
                >
                  <span className="grid">
                    <span>{h.title || "Untitled chat"}</span>
                    <span className="text-[12px] font-normal text-mut">{h.snippet}</span>
                  </span>
                </Item>
              ))}
            </Command.Group>
          ) : null}
          <Command.Group heading="Commands" className="text-[13px] text-mut">
            {commandItems(rest.filter((c) => c.group === "Actions"))}
          </Command.Group>
        </Command.List>
        <p className="m-0 border-t border-line px-3 py-1.5 text-[13px] text-mut">
          <kbd>Enter</kbd> opens, <kbd>Esc</kbd> closes, <kbd>Ctrl /</kbd> lists the keys. Decisions
          are made on the card, not here.
        </p>
      </Command>
    </div>
  )
}

interface ChatHit {
  conversationId: string
  messageId: string
  title: string
  snippet: string
}

/** Searches your chats as you type, from two letters, a moment after you stop. */
function useChatSearch(query: string): ChatHit[] {
  const [hits, setHits] = useState<ChatHit[]>([])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      void api<{ hits: ChatHit[] }>("GET", `/api/chat/search?q=${encodeURIComponent(q)}`).then(
        (r) => {
          if (live) setHits(r.ok && r.data ? r.data.hits.slice(0, 20) : [])
        },
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])
  return hits
}

function Item({
  value,
  onSelect,
  keys,
  children,
}: {
  value: string
  onSelect: () => void
  keys?: string | undefined
  children: React.ReactNode
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-1.5 text-tx data-[selected=true]:bg-s2 data-[selected=true]:font-semibold"
    >
      <span>{children}</span>
      {keys ? <kbd className="text-[12px]">{keys}</kbd> : null}
    </Command.Item>
  )
}
