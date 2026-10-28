import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { diffLines } from "diff"
import { memo, useEffect, useId, useMemo, useRef, useState } from "react"
import Markdown from "react-markdown"
import { Virtuoso } from "react-virtuoso"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { emptyTranscript, type Item, type Todo } from "../lib/transcript"
import { money } from "../lib/format"
import { send, usePending, useSessionList, useStore } from "../store"
import { MODELS } from "./Sessions"
import { SessionCode } from "../components/SessionCode"
import { FilesPanel, Viewer, type Opened } from "../components/FilesPanel"
import { sessionCode } from "../lib/codes"
import { EFFORTS, MODE_OPTIONS, uiModeOf, wireOf, type EffortId, type UiMode } from "../lib/modes"

/** Moves a session to a mode. Extreme approval is Manual plus the session flag, so both are set in order. */
async function changeMode(session: SessionInfo, m: UiMode) {
  const w = wireOf(m)
  if (session.mode !== w.mode) await send({ type: "set_mode", sessionId: session.id, mode: w.mode })
  if ((session.extreme === true) !== w.extreme)
    await send({ type: "set_extreme", sessionId: session.id, on: w.extreme })
}

const SLASH: Array<{ cmd: string; help: string }> = [
  { cmd: "/plan", help: "Switch this session to Plan" },
  { cmd: "/default", help: "Switch this session to Manual" },
  { cmd: "/accept-edits", help: "Switch this session to Accept edits" },
  { cmd: "/auto", help: "Switch this session to Auto" },
  { cmd: "/extreme", help: "Turn Extreme approval on or off for this session" },
  { cmd: "/effort", help: "Set effort: low, medium, high, xhigh or max" },
  { cmd: "/model", help: "Change model, for example /model claude-sonnet-5-5" },
  { cmd: "/stop", help: "Interrupt the current turn" },
  { cmd: "/close", help: "End this session" },
]

/** The workspace: one session, or up to three side by side, each with its own transcript, files and composer. */
export function Workspace() {
  const sessions = useStore((s) => s.sessions)
  const storePanes = useStore((s) => s.panes)
  const selected = useStore((s) => s.selectedSession)
  const selectSession = useStore((s) => s.selectSession)
  const setRoute = useStore((s) => s.setRoute)
  const setPane = useStore((s) => s.setPane)
  const sessionList = useSessionList()
  const list = useMemo(
    () => [...sessionList].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [sessionList],
  )
  const panes = useMemo(() => {
    const live = storePanes.filter((id) => sessions[id])
    return live.length ? live : selected && sessions[selected] ? [selected] : []
  }, [storePanes, sessions, selected])
  const session = panes[0] ? sessions[panes[0]] : undefined

  if (!session) {
    return (
      <div className="mx-auto mt-14 grid max-w-xl gap-4 px-6">
        <div>
          <h1 className="m-0">Pick a session</h1>
          <p className="m-0 mt-1 text-mut">
            {list.length === 0
              ? "No sessions are running. Start one from the Sessions page."
              : "Choose a session to see its transcript and work with it."}
          </p>
        </div>
        {list.length > 0 ? (
          <div className="panel overflow-hidden">
            {list.map((s) => (
              <button
                key={s.id}
                className="board-row grid-cols-[auto_minmax(0,1fr)_auto]"
                data-lit={s.state === "waiting" ? "" : undefined}
                onClick={() => selectSession(s.id)}
              >
                <SessionCode session={s} className="!text-[15px]" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{s.project}</span>
                  <span className="mono block truncate text-xs text-mut">{s.cwd}</span>
                </span>
                <span className="text-[13px] text-mut">
                  {s.state === "waiting" ? "Waiting on you" : s.state}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div>
          <button className="btn" onClick={() => setRoute("sessions")}>
            Go to sessions
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="grid h-full min-h-0 divide-x divide-line"
      style={{ gridTemplateColumns: `repeat(${panes.length}, minmax(0, 1fr))` }}
    >
      {panes.map((id, i) => (
        <SessionPane
          key={`${i}:${id}`}
          sessionId={id}
          onChangeSession={(next) => setPane(i, next)}
          controls={<PaneControls index={i} current={id} panes={panes} list={list} />}
        />
      ))}
    </div>
  )
}

/** Open another session beside this one, or close this pane. */
function PaneControls({
  index,
  current,
  panes,
  list,
}: {
  index: number
  current: string
  panes: string[]
  list: SessionInfo[]
}) {
  const openBeside = useStore((s) => s.openBeside)
  const closePane = useStore((s) => s.closePane)
  const others = list.filter((s) => !panes.includes(s.id))
  const last = index === panes.length - 1
  return (
    <span className="flex items-center gap-2">
      {last && panes.length < 3 && others.length > 0 ? (
        <label className="flex items-center gap-1">
          <span className="sr-only">Open another session beside this one</span>
          <select
            className="field"
            value=""
            onChange={(e) => e.target.value && openBeside(e.target.value)}
          >
            <option value="">Open beside…</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionCode(s)} {s.project}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {panes.length > 1 ? (
        <button
          type="button"
          className="btn"
          aria-label={`Close the pane for ${current}`}
          onClick={() => closePane(index)}
        >
          Close pane
        </button>
      ) : null}
    </span>
  )
}

function SessionPane({
  sessionId,
  onChangeSession,
  controls,
}: {
  sessionId: string
  onChangeSession: (id: string) => void
  controls: React.ReactNode
}) {
  const sessions = useStore((s) => s.sessions)
  const selected = sessionId
  const setRoute = useStore((s) => s.setRoute)
  const selectRequest = useStore((s) => s.selectRequest)
  const transcript =
    useStore((s) => (selected ? s.transcripts[selected] : undefined)) ?? emptyTranscript()
  const allPending = usePending()
  const pending = useMemo(
    () => allPending.filter((p) => p.request.sessionId === selected),
    [allPending, selected],
  )
  const sessionList = useSessionList()
  const list = useMemo(
    () => [...sessionList].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [sessionList],
  )
  const session = selected ? sessions[selected] : undefined
  const [opened, setOpened] = useState<Opened>()
  const [side, setSide] = useState<"files" | "plan">("files")
  // A file from one session is never shown in another.
  useEffect(() => setOpened(undefined), [selected])

  const [railOpen, setRailOpen] = useState(false)
  if (!session) return null

  const running = session.state === "running" || session.state === "waiting"
  const ended = session.state === "ended" || session.state === "error"

  return (
    <div
      className="pane relative grid h-full min-w-0 grid-rows-[auto_1fr_auto]"
      data-rail={railOpen ? "open" : undefined}
      data-viewer={opened ? "" : undefined}
      aria-label={`Session ${session.project}`}
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-s1 px-4 py-2.5">
        <SessionCode session={session} className="!text-[17px]" />
        <div className="grid min-w-[220px] flex-1 gap-0.5">
          <label className="flex items-center gap-2">
            <span className="sr-only">Session</span>
            <select
              className="field"
              value={session.id}
              onChange={(e) => onChangeSession(e.target.value)}
            >
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionCode(s)} {s.project} ({s.state})
                </option>
              ))}
            </select>
          </label>
          <span className="mono truncate text-xs text-mut">{session.cwd}</span>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-mut">Model</span>
          <select
            className="field"
            value={MODELS.some((m) => m.id === (session.model ?? "")) ? (session.model ?? "") : ""}
            disabled={ended}
            onChange={(e) =>
              void send({
                type: "set_model",
                sessionId: session.id,
                ...(e.target.value ? { model: e.target.value } : {}),
              })
            }
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-mut">Effort</span>
          <select
            className="field"
            value={session.effort ?? ""}
            disabled={ended}
            onChange={(e) =>
              e.target.value &&
              void send({
                type: "set_effort",
                sessionId: session.id,
                effort: e.target.value as EffortId,
              })
            }
          >
            <option value="" disabled>
              Model default
            </option>
            {EFFORTS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-mut">Mode</span>
          <select
            className="field"
            value={uiModeOf(session)}
            disabled={ended}
            onChange={(e) => void changeMode(session, e.target.value as UiMode)}
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-deny"
          disabled={!running}
          onClick={() => void send({ type: "interrupt", sessionId: session.id })}
        >
          Interrupt
        </button>
        <button
          type="button"
          className="btn pane-rail-toggle"
          aria-expanded={railOpen}
          onClick={() => setRailOpen((v) => !v)}
        >
          Files and plan
        </button>
        {controls}
      </header>

      <div className="pane-body min-h-0">
        <section aria-label="Transcript" className="pane-transcript min-h-0">
          <Virtuoso
            style={{ height: "100%" }}
            data={transcript.items}
            followOutput="smooth"
            initialTopMostItemIndex={Math.max(0, transcript.items.length - 1)}
            computeItemKey={(_, it) => it.id}
            itemContent={(_, it) => (
              <div className="mx-auto max-w-[860px] px-5 py-1.5">
                <ItemView item={it} />
              </div>
            )}
            components={{
              EmptyPlaceholder: () => (
                <p className="mx-auto max-w-[860px] p-6 text-mut">
                  Nothing yet. Write a prompt below to start the work.
                </p>
              ),
            }}
          />
        </section>
        {opened ? (
          <Viewer
            key={opened.kind === "file" ? opened.rel : "browser"}
            sessionId={session.id}
            opened={opened}
            onClose={() => setOpened(undefined)}
            onNavigate={setOpened}
          />
        ) : null}
        <aside
          aria-label="Files and plan"
          className="pane-rail min-h-0 grid-rows-[auto_1fr] border-l border-line bg-s1"
        >
          <div role="tablist" aria-label="Side panel" className="flex border-b border-line px-2">
            {(["files", "plan"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={side === t}
                className={clsx(
                  "sign -mb-px border-0 border-b-2 border-transparent bg-transparent px-3 py-2 text-[14px]",
                  side === t && "border-acc font-semibold",
                )}
                onClick={() => setSide(t)}
              >
                {t === "files" ? "Files" : "Plan"}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 overflow-auto p-4">
            {side === "files" ? (
              <FilesPanel
                sessionId={session.id}
                cwd={session.cwd}
                items={transcript.items}
                onOpen={setOpened}
              />
            ) : (
              <>
                <TodoPanel todos={transcript.todos} />
                <SessionFacts sessionId={session.id} />
              </>
            )}
          </div>
        </aside>
      </div>

      <footer className="border-t border-line bg-s1 p-3">
        {pending.length > 0 ? (
          <div
            role="status"
            className="mb-2 flex items-center gap-3 rounded bg-sign px-3 py-1.5 text-sign-tx"
          >
            <span className="font-semibold">
              {pending.length} request{pending.length === 1 ? "" : "s"} from this session waiting on
              you
            </span>
            <button
              className="btn ml-auto"
              onClick={() => {
                selectRequest(pending[0]?.request.id)
                setRoute("approvals")
              }}
            >
              Open
            </button>
          </div>
        ) : null}
        <Composer sessionId={session.id} disabled={ended} />
      </footer>
    </div>
  )
}

function Composer({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  // One composer per pane in split view, so its id must be its own.
  const composerId = useId()
  const [text, setText] = useState("")
  const [active, setActive] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const addUserText = useStore((s) => s.addUserText)

  const showMenu = text.startsWith("/") && !text.includes(" ") && !text.includes("\n")
  const matches = showMenu ? SLASH.filter((c) => c.cmd.startsWith(text.toLowerCase())) : []

  async function submit() {
    const t = text.trim()
    if (!t) return
    if (t.startsWith("/")) {
      const [cmd, ...rest] = t.split(/\s+/)
      const arg = rest.join(" ")
      let r
      switch (cmd?.toLowerCase()) {
        case "/plan":
          r = await send({ type: "set_mode", sessionId, mode: "plan" })
          break
        case "/default":
          r = await send({ type: "set_mode", sessionId, mode: "default" })
          break
        case "/accept-edits":
          r = await send({ type: "set_mode", sessionId, mode: "acceptEdits" })
          break
        case "/auto":
          r = await send({ type: "set_mode", sessionId, mode: "auto" })
          break
        case "/extreme": {
          const cur = useStore.getState().sessions[sessionId]?.extreme === true
          r = await send({ type: "set_extreme", sessionId, on: !cur })
          break
        }
        case "/effort":
          r = EFFORTS.some((x) => x.id === arg)
            ? await send({ type: "set_effort", sessionId, effort: arg as EffortId })
            : {
                ok: false,
                error: { code: "bad-effort", message: "Use low, medium, high, xhigh or max" },
              }
          break
        case "/model":
          r = await send({ type: "set_model", sessionId, ...(arg ? { model: arg } : {}) })
          break
        case "/stop":
          r = await send({ type: "interrupt", sessionId })
          break
        case "/close":
          r = await send({ type: "close_session", sessionId })
          break
        default:
          toast.error(`Unknown command ${cmd}. Type / to see the list.`)
          return
      }
      if (!r.ok) toast.error(r.error?.message ?? "That did not work")
      setText("")
      return
    }
    addUserText(sessionId, t)
    setText("")
    const r = await send({ type: "prompt", sessionId, text: t })
    if (!r.ok) toast.error(r.error?.message ?? "The prompt was not sent")
  }

  return (
    <div className="relative grid gap-1">
      {matches.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Commands"
          className="panel absolute bottom-full left-0 z-10 mb-1 m-0 w-[420px] list-none p-1"
        >
          {matches.map((c, i) => (
            <li key={c.cmd} role="option" aria-selected={i === active}>
              <button
                className={clsx(
                  "flex w-full gap-3 rounded border-0 bg-transparent px-2 py-1 text-left",
                  i === active && "bg-s2",
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setText(c.cmd + " ")
                  area.current?.focus()
                }}
              >
                <span className="mono font-semibold">{c.cmd}</span>
                <span className="text-mut">{c.help}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={composerId} className="sr-only">
        Prompt
      </label>
      <textarea
        id={composerId}
        ref={area}
        className="field w-full resize-y"
        rows={2}
        maxLength={100_000}
        disabled={disabled}
        placeholder={
          disabled
            ? "This session has ended"
            : "Write a prompt. Enter sends, Shift+Enter adds a line. / for commands."
        }
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault()
            setActive(
              (a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length,
            )
          } else if (matches.length > 0 && e.key === "Tab") {
            e.preventDefault()
            setText((matches[active]?.cmd ?? text) + " ")
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
    </div>
  )
}

function TodoPanel({ todos }: { todos: Todo[] }) {
  return (
    <section aria-label="Todo list">
      <h2 className="m-0 mb-2 text-[15px]">Todo list</h2>
      {todos.length === 0 ? (
        <p className="m-0 text-mut">Claude has not made a list yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {todos.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-center">
                {t.status === "completed" ? "✓" : t.status === "in_progress" ? "▶" : "○"}
              </span>
              <span className={t.status === "completed" ? "text-mut line-through" : undefined}>
                {t.content}
                <span className="sr-only">{`, ${t.status.replace("_", " ")}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SessionFacts({ sessionId }: { sessionId: string }) {
  const cost = useStore((s) => s.usage?.bySession?.[sessionId]?.costUsd)
  return cost === undefined ? null : (
    <p className="mt-6 text-mut">
      Spend this session: <strong>{money(cost)}</strong>
    </p>
  )
}

export const ItemView = memo(function ItemView({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-md border border-line bg-s2 px-3 py-2 [overflow-wrap:anywhere]">
          <span className="sr-only">You: </span>
          {item.text}
        </div>
      )
    case "text":
      return (
        <div
          className={clsx(
            "[overflow-wrap:anywhere] [&_code]:font-[var(--font-code)] [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-s2 [&_pre]:p-3 [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2",
            item.subagent && "ml-5 border-l-2 border-line pl-3",
          )}
        >
          <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
        </div>
      )
    case "thinking":
      return (
        <details className="text-mut">
          <summary className="cursor-pointer">Thinking</summary>
          <p className="whitespace-pre-wrap">{item.text}</p>
        </details>
      )
    case "tool":
      return <ToolCard item={item} />
    case "result":
      return (
        <p className={clsx("m-0 text-xs", item.isError ? "font-semibold text-sev" : "text-mut")}>
          {item.isError ? "Turn ended with an error: " : "Turn finished. "}
          {item.isError ? item.text : ""}
          {item.costUsd !== undefined ? ` Session cost so far ${money(item.costUsd)}.` : ""}
        </p>
      )
    case "system":
      return <p className="m-0 text-xs text-mut">{item.text}</p>
  }
})

function ToolCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const input = item.input
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined)
  const isShell = item.name === "Bash" || item.name === "PowerShell"
  const path = s("file_path") ?? s("path")
  const edit =
    item.name === "Edit" && s("old_string") !== undefined && s("new_string") !== undefined
  return (
    <details className={clsx("panel", item.subagent && "ml-5")} open={edit || undefined}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-3 py-1.5">
        <strong>{item.name}</strong>
        <span className="mono min-w-0 flex-1 truncate text-xs text-mut">
          {isShell
            ? s("command")?.split("\n")[0]
            : (path ?? s("pattern") ?? s("description") ?? "")}
        </span>
        {item.result ? (
          <span
            className={clsx("text-xs", item.result.isError ? "font-semibold text-sev" : "text-mut")}
          >
            {item.result.isError ? "Failed" : "Done"}
          </span>
        ) : (
          <span className="text-xs text-mut">Running or waiting</span>
        )}
      </summary>
      <div className="grid gap-2 border-t border-line p-3">
        {isShell ? (
          <pre className="cmd">{s("command")}</pre>
        ) : edit ? (
          <DiffView oldText={s("old_string") as string} newText={s("new_string") as string} />
        ) : (
          <pre className="cmd">{JSON.stringify(input, null, 2)}</pre>
        )}
        {path ? <p className="mono m-0 text-xs text-mut [overflow-wrap:anywhere]">{path}</p> : null}
        {item.result ? (
          <pre className={clsx("cmd max-h-72 overflow-auto", item.result.isError && "text-sev")}>
            {item.result.text.length > 20_000
              ? item.result.text.slice(0, 20_000) +
                `\n[${item.result.text.length - 20_000} more characters not shown]`
              : item.result.text || "(no output)"}
          </pre>
        ) : null}
      </div>
    </details>
  )
}

/** Line diff with +/- markers as well as colour, so it reads in any theme and without colour. */
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText])
  return (
    <pre className="cmd max-h-96 overflow-auto !p-0" aria-label="Changes">
      {parts.flatMap((p, i) =>
        p.value
          .replace(/\n$/, "")
          .split("\n")
          .map((line, j) => (
            <div
              key={`${i}-${j}`}
              className={clsx(
                "px-3",
                p.added && "bg-hi font-semibold",
                p.removed && "text-sev line-through decoration-1",
              )}
            >
              <span aria-hidden="true" className="mr-2 inline-block w-3 select-none">
                {p.added ? "+" : p.removed ? "-" : " "}
              </span>
              <span className="sr-only">
                {p.added ? "Added: " : p.removed ? "Removed: " : "Unchanged: "}
              </span>
              {line}
            </div>
          )),
      )}
    </pre>
  )
}
