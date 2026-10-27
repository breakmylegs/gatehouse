import clsx from "clsx"
import { diffLines } from "diff"
import { memo, useMemo, useRef, useState } from "react"
import Markdown from "react-markdown"
import { Virtuoso } from "react-virtuoso"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { emptyTranscript, type Item, type Todo } from "../lib/transcript"
import { money } from "../lib/format"
import { send, usePending, useSessionList, useStore } from "../store"
import { MODELS } from "./Sessions"

const SLASH: Array<{ cmd: string; help: string }> = [
  { cmd: "/plan", help: "Switch this session to plan mode" },
  { cmd: "/default", help: "Switch this session to default mode" },
  { cmd: "/model", help: "Change model, for example /model claude-sonnet-5-5" },
  { cmd: "/stop", help: "Interrupt the current turn" },
  { cmd: "/close", help: "End this session" },
]

export function Workspace() {
  const sessions = useStore((s) => s.sessions)
  const selected = useStore((s) => s.selectedSession)
  const selectSession = useStore((s) => s.selectSession)
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

  if (!session) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <h1 className="m-0 text-base font-semibold">No session selected</h1>
        <p className="text-mut">
          {list.length === 0
            ? "Start a session from the Sessions page."
            : "Pick one to see its transcript."}
        </p>
        {list.map((s) => (
          <button key={s.id} className="btn mr-2" onClick={() => selectSession(s.id)}>
            {s.project}
          </button>
        ))}
        <div className="mt-3">
          <button className="btn" onClick={() => setRoute("sessions")}>
            Go to sessions
          </button>
        </div>
      </div>
    )
  }

  const running = session.state === "running" || session.state === "waiting"
  const ended = session.state === "ended" || session.state === "error"

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] max-[900px]:grid-rows-[auto_1fr_auto]">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-s1 px-4 py-2">
        <label className="flex items-center gap-2">
          <span className="text-mut">Session</span>
          <select
            className="field"
            value={session.id}
            onChange={(e) => selectSession(e.target.value)}
          >
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.project}
              </option>
            ))}
          </select>
        </label>
        <span className="mono text-xs text-mut [overflow-wrap:anywhere]">{session.cwd}</span>
        <span className="ml-auto" />
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
        <div role="group" aria-label="Mode" className="flex">
          {(["default", "plan"] as const).map((m) => (
            <button
              key={m}
              className={clsx(
                "btn !rounded-none first:!rounded-l-md last:!rounded-r-md",
                session.mode === m && "btn-primary",
              )}
              aria-pressed={session.mode === m}
              disabled={ended}
              onClick={() => void send({ type: "set_mode", sessionId: session.id, mode: m })}
            >
              {m === "plan" ? "Plan" : "Default"}
            </button>
          ))}
        </div>
        <button
          className="btn btn-deny"
          disabled={!running}
          onClick={() => void send({ type: "interrupt", sessionId: session.id })}
        >
          Interrupt
        </button>
      </header>

      <div className="grid min-h-0 grid-cols-[1fr_260px] max-[1100px]:grid-cols-1">
        <section aria-label="Transcript" className="min-h-0">
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
        <aside
          aria-label="Plan and progress"
          className="hidden overflow-auto border-l border-line bg-s1 p-4 min-[1100px]:block"
        >
          <TodoPanel todos={transcript.todos} />
          <SessionFacts sessionId={session.id} />
        </aside>
      </div>

      <footer className="border-t border-line bg-s1 p-3">
        {pending.length > 0 ? (
          <div
            role="status"
            className="mb-2 flex items-center gap-3 rounded-md border border-line bg-s2 px-3 py-1.5"
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
      <label htmlFor="composer" className="sr-only">
        Prompt
      </label>
      <textarea
        id="composer"
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
      <h2 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-mut">
        Todo list
      </h2>
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

const ItemView = memo(function ItemView({ item }: { item: Item }) {
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
