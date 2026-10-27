import { Command } from "cmdk"
import { useEffect, useRef, useState } from "react"
import { type Route, usePending, useSessionList, useStore } from "../store"

const SURFACES: Array<{ route: Route; label: string }> = [
  { route: "approvals", label: "Approvals" },
  { route: "sessions", label: "Sessions" },
  { route: "workspace", label: "Workspace" },
  { route: "policy", label: "Policy" },
  { route: "audit", label: "Audit log" },
  { route: "devices", label: "Devices" },
  { route: "settings", label: "Settings" },
]

/**
 * Ctrl+K: jump to a surface, a session or a waiting request, or switch theme. It only moves you around. It
 * has no allow, deny or kill action on purpose: a decision always happens on the card, with its own safeguards.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const back = useRef<HTMLElement | null>(null)
  const setRoute = useStore((s) => s.setRoute)
  const selectSession = useStore((s) => s.selectSession)
  const selectRequest = useStore((s) => s.selectRequest)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const sessions = useSessionList()
  const pending = usePending()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        back.current = document.activeElement as HTMLElement | null
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const close = () => {
    setOpen(false)
    back.current?.focus?.()
  }
  const run = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  if (!open) return null
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
          placeholder="Go to a page, session or waiting request"
          className="field w-full !rounded-none !border-0 !border-b !border-line"
        />
        <Command.List className="max-h-80 overflow-auto p-1">
          <Command.Empty className="p-3 text-mut">Nothing matches.</Command.Empty>
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
          <Command.Group heading="Pages" className="text-[13px] text-mut">
            {SURFACES.map((s) => (
              <Item key={s.route} value={`go ${s.label}`} onSelect={run(() => setRoute(s.route))}>
                {s.label}
              </Item>
            ))}
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
          <Command.Group heading="Other" className="text-[13px] text-mut">
            <Item
              value="switch theme dark light"
              onSelect={run(() => setTheme(theme === "dark" ? "light" : "dark"))}
            >
              Switch to {theme === "dark" ? "light" : "dark"} theme
            </Item>
          </Command.Group>
        </Command.List>
        <p className="m-0 border-t border-line px-3 py-1.5 text-[13px] text-mut">
          <kbd>Enter</kbd> opens, <kbd>Esc</kbd> closes. Decisions are made on the card, not here.
        </p>
      </Command>
    </div>
  )
}

function Item({
  value,
  onSelect,
  children,
}: {
  value: string
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="cursor-pointer rounded px-3 py-1.5 text-tx data-[selected=true]:bg-s2 data-[selected=true]:font-semibold"
    >
      {children}
    </Command.Item>
  )
}
