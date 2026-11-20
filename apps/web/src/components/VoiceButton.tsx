import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { voiceCopy } from "../lib/platform-mac" // Mac fork
import { inShell, tellShell } from "../lib/shell"
import { insertAtCaret, setVoiceMode, startRecording, transcribe, voiceMode, type VoiceMode } from "../lib/voice-server"
import { Icon } from "./Icon"

/**
 * Voice (W1-16): a microphone beside the prompt box that starts Windows voice typing there, as Win+H does. It is off
 * until you switch it on in Settings, because Windows voice typing may send what you say to Microsoft to be
 * recognised, and the plan leaves that to your organisation's IT. Codehouse hears nothing itself: Windows types the words.
 *
 * T-136: or, by your choice, a speech server on this computer (Whisper-compatible, on 127.0.0.1): press to record,
 * press again to stop, and the words go where the caret is. Nothing leaves this computer and nothing is kept.
 */
const KEY = "gatehouse.voiceTyping"
const CHANGED = "codeh:voice"

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function setVoiceTyping(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1")
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
  window.dispatchEvent(new Event(CHANGED))
}

const subscribe = (f: () => void) => {
  window.addEventListener(CHANGED, f)
  return () => window.removeEventListener(CHANGED, f)
}
export const useVoiceTyping = () => useSyncExternalStore(subscribe, read)
const useVoiceMode = () => useSyncExternalStore(subscribe, voiceMode)

export function VoiceButton({
  target,
  disabled,
}: {
  target: RefObject<HTMLTextAreaElement | null>
  disabled?: boolean
}) {
  const on = useVoiceTyping()
  const mode = useVoiceMode()
  const [state, setState] = useState<"idle" | "recording" | "working">("idle")
  const recording = useRef<{ stop: () => Promise<Blob> }>(undefined)
  if (!on || !inShell()) return null
  async function server() {
    if (state === "working") return
    if (state === "idle") {
      try {
        recording.current = await startRecording()
        setState("recording")
      } catch {
        toast.error("The microphone could not be used.", { id: "voice" })
      }
      return
    }
    setState("working")
    const blob = await recording.current!.stop()
    recording.current = undefined
    const r = await transcribe(blob)
    setState("idle")
    if ("error" in r) return toast.error(r.error, { id: "voice" })
    if (target.current && r.text) insertAtCaret(target.current, r.text)
    target.current?.focus()
  }
  return (
    <button
      type="button"
      className="btn composer-icon"
      aria-label={mode === "server" ? (state === "recording" ? "Stop recording" : state === "working" ? "Recognising speech" : "Speak") : voiceCopy().label} // Mac fork
      aria-pressed={mode === "server" ? state === "recording" : undefined}
      title={mode === "server" ? "Speak: press to record, again to stop. Recognised by the speech server on this computer." : voiceCopy().title}
      disabled={disabled || state === "working"}
      onClick={() => {
        if (mode === "server") return void server()
        // Windows types into whatever has the focus, so the prompt box takes it first.
        target.current?.focus()
        tellShell("voice")
      }}
    >
      <Icon name="microphone" />
    </button>
  )
}

/** Settings: the switch for the microphone button, and (T-136) what recognises the speech. */
export function VoiceSetting() {
  const on = useVoiceTyping()
  const mode = useVoiceMode()
  const [server, setServer] = useState({ url: "", words: "" })
  useEffect(() => {
    void api<{ server: { url: string; words?: string[] } | null }>("GET", "/api/voice-server").then((r) => {
      if (r.ok && r.data?.server) setServer({ url: r.data.server.url, words: (r.data.server.words ?? []).join(", ") })
    })
  }, [])
  async function save() {
    const words = server.words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean)
    const r = await api("PUT", "/api/voice-server", { server: server.url.trim() ? { url: server.url.trim(), words } : null })
    if (!r.ok) return toast.error(r.error ?? "Not saved", { id: "voice" })
    toast(server.url.trim() ? "Speech server saved" : "Speech server removed", { id: "voice" })
  }
  if (!inShell()) return <p className="m-0 text-xs text-mut">{voiceCopy().browser}</p> // Mac fork
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setVoiceTyping(e.target.checked)} />
        <span>Show a microphone beside the prompt box</span>
      </label>
      {/* Mac fork */}
      <p className="m-0 text-xs text-mut">{voiceCopy().setting}</p>
      <fieldset className="m-0 grid gap-1 border-0 p-0 text-sm">
        <legend className="mb-1 text-sm">Recognised by</legend>
        {(
          [
            ["windows", "The system's own voice typing"],
            ["server", "A speech server on this computer (Whisper-compatible)"],
          ] as Array<[VoiceMode, string]>
        ).map(([m, label]) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="voice-mode" checked={mode === m} onChange={() => setVoiceMode(m)} />
            {label}
          </label>
        ))}
      </fieldset>
      {mode === "server" ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <p className="m-0 text-xs text-mut">
            Run a Whisper-compatible server (whisper.cpp&apos;s server, faster-whisper-server) on this computer and give its
            address. Only one on 127.0.0.1 or localhost is accepted, so what you say never leaves this computer. Words to
            expect help it with names and terms; um, uh and the like are taken out.
          </p>
          <label className="grid gap-1 text-sm">
            <span>Address</span>
            <input className="field mono" placeholder="http://127.0.0.1:8080" value={server.url} onChange={(e) => setServer({ ...server, url: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Words to expect, separated by commas</span>
            <textarea className="field" rows={2} value={server.words} onChange={(e) => setServer({ ...server, words: e.target.value })} />
          </label>
          <button className="btn justify-self-start">Save the speech server</button>
        </form>
      ) : null}
    </>
  )
}
