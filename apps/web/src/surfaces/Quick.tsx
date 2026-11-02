import { useEffect, useMemo, useRef, useState } from "react"
import { chatName } from "../lib/chatName"
import { onShell, tellShell } from "../lib/shell"
import { titleOf } from "../lib/sessionActions"
import { accountForNew, send, useSessionList } from "../store"

/** How long starting a chat may take before the quick prompt gives up waiting. */
const START_WAIT_MS = 60_000

/**
 * The quick prompt (W1-15): the page in the small window the shortcut opens over whatever you are doing. It starts a
 * chat, or messages the coding session you started last, then opens the main window there. Esc puts it away and
 * gives the focus back to the program you were in.
 */
export function Quick() {
  const sessions = useSessionList()
  const current = useMemo(
    () =>
      sessions
        .filter(
          (s) => s.kind !== "chat" && s.state !== "ended" && s.state !== "error" && !s.archived,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [sessions],
  )
  const [text, setText] = useState("")
  const [to, setTo] = useState<"chat" | "session">("chat")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    box.current?.focus()
    return onShell((m) => {
      if (m !== "quick-shown") return
      setError(undefined)
      box.current?.focus()
      // Shown: have a chat start now, so it is ready, or nearly, by the time you press Enter (the warm chat).
      void send({ type: "warm_chat" }).catch(() => undefined)
    })
  }, [])

  const target = to === "session" ? current : undefined

  async function go() {
    const said = text.trim()
    if (!said || busy) return
    setBusy(true)
    setError(undefined)
    let id = target?.id
    if (!id) {
      const r = await send(
        {
          type: "create_session",
          // The Host gives a chat a folder of its own and keeps it in Plan mode, as New chat does.
          cwd: "chat",
          kind: "chat",
          // Only the start names the chat; the whole message is sent as the prompt (up to 100,000 characters).
          title: chatName(said),
          mode: "plan",
          ...accountForNew(),
        },
        START_WAIT_MS,
      )
      if (!r.ok) {
        setBusy(false)
        setError(r.error?.message ?? "The chat did not start")
        return
      }
      id = (r.data as { sessionId: string }).sessionId
    }
    const r = await send({ type: "prompt", sessionId: id, text: said })
    setBusy(false)
    if (!r.ok) {
      setError(r.error?.message ?? "That was not sent")
      return
    }
    setText("")
    tellShell(`quick-open:${JSON.stringify({ session: id, text: said })}`)
  }

  return (
    <form
      className="grid h-screen grid-rows-[auto_1fr_auto] gap-2 p-3"
      aria-label="Quick prompt"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          tellShell("quick-close")
        }
      }}
      onSubmit={(e) => {
        e.preventDefault()
        void go()
      }}
    >
      <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0 text-[13px]">
        <legend className="sr-only">Send to</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="to" checked={!target} onChange={() => setTo("chat")} />
          <span>A new chat</span>
        </label>
        {current ? (
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="to"
              checked={Boolean(target)}
              onChange={() => setTo("session")}
            />
            <span>{titleOf(current)}</span>
          </label>
        ) : null}
        <span className="ml-auto text-mut">Esc puts this away</span>
      </fieldset>
      <textarea
        ref={box}
        className="field resize-none"
        aria-label={target ? `Message ${titleOf(target)}` : "Ask in a new chat"}
        placeholder={target ? `Message ${titleOf(target)}` : "Ask anything"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void go()
          }
        }}
      />
      <div className="flex items-center gap-2">
        {error ? (
          <p role="alert" className="m-0 text-[13px] text-bad">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary ml-auto" disabled={busy || !text.trim()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  )
}
