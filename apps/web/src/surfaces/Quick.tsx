import { useEffect, useMemo, useRef, useState } from "react"
import { chatName } from "../lib/chatName"
import { api } from "../lib/api"
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
  // CH-08: the chat you used last, to carry on there instead of starting a new one.
  const lastChat = useMemo(
    () =>
      sessions
        .filter(
          (s) => s.kind === "chat" && s.state !== "ended" && s.state !== "error" && !s.archived,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [sessions],
  )
  const [text, setText] = useState("")
  const [to, setTo] = useState<"chat" | "last-chat" | "session">("chat")
  /** A picture of the screen to attach (CH-08): PNG bytes as base64. Pictures are not redacted. */
  const [picture, setPicture] = useState<string>()
  const [capturing, setCapturing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    box.current?.focus()
    return onShell((m) => {
      if (m.startsWith("captured:")) {
        setCapturing(false)
        setPicture(m.slice("captured:".length))
        return
      }
      if (m === "capture-none") {
        setCapturing(false)
        return
      }
      if (m !== "quick-shown") return
      setError(undefined)
      box.current?.focus()
      // Shown: have a chat start now, so it is ready, or nearly, by the time you press Enter (the warm chat).
      void send({ type: "warm_chat" }).catch(() => undefined)
    })
  }, [])

  const target = to === "session" ? current : to === "last-chat" ? lastChat : undefined

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
    // The picture goes into the chat's folder first, and the message points at it. The Host records it as a screen
    // capture: pictures are not redacted.
    let message = said
    if (picture) {
      const a = await api<{ rel: string }>("POST", "/api/files/attach-data", {
        session: id,
        type: "image/png",
        name: "screen.png",
        data: picture,
        source: "screen-capture",
      })
      if (!a.ok || !a.data) {
        setBusy(false)
        setError(a.error ?? "The picture could not be attached")
        return
      }
      message = `@${a.data.rel}\n\n${said}`
    }
    const r = await send({ type: "prompt", sessionId: id, text: message })
    setBusy(false)
    if (!r.ok) {
      setError(r.error?.message ?? "That was not sent")
      return
    }
    setText("")
    setPicture(undefined)
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
          <input
            type="radio"
            name="to"
            checked={to === "chat" || !target}
            onChange={() => setTo("chat")}
          />
          <span>A new chat</span>
        </label>
        {lastChat ? (
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="to"
              checked={to === "last-chat"}
              onChange={() => setTo("last-chat")}
            />
            <span>{titleOf(lastChat)}</span>
          </label>
        ) : null}
        {current ? (
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="to"
              checked={to === "session" && Boolean(target)}
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
      {picture ? (
        <div className="flex items-center gap-2 text-[12.5px]">
          <img
            src={`data:image/png;base64,${picture}`}
            alt="The picture to attach"
            className="h-12 rounded border border-line"
          />
          <span role="note" className="text-mut">
            Pictures are not redacted: what is in it goes to Claude as it is.
          </span>
          <button
            type="button"
            className="btn !min-h-7 ml-auto"
            onClick={() => setPicture(undefined)}
          >
            Remove
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn !min-h-7"
          disabled={capturing}
          onClick={() => {
            setCapturing(true)
            tellShell("capture:region")
          }}
        >
          Part of the screen
        </button>
        <button
          type="button"
          className="btn !min-h-7"
          disabled={capturing}
          onClick={() => {
            setCapturing(true)
            tellShell("capture:window")
          }}
        >
          The window you were in
        </button>
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
