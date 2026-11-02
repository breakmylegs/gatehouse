import { useSyncExternalStore, type RefObject } from "react"
import { inShell, tellShell } from "../lib/shell"
import { Icon } from "./Icon"

/**
 * Voice (W1-16): a microphone beside the prompt box that starts Windows voice typing there, as Win+H does. It is off
 * until you switch it on in Settings, because Windows voice typing may send what you say to Microsoft to be
 * recognised, and the plan leaves that to your organisation's IT. Codehouse hears nothing itself: Windows types the words.
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

export function VoiceButton({
  target,
  disabled,
}: {
  target: RefObject<HTMLTextAreaElement | null>
  disabled?: boolean
}) {
  const on = useVoiceTyping()
  if (!on || !inShell()) return null
  return (
    <button
      type="button"
      className="btn !min-h-9 !w-9 justify-center !px-0"
      aria-label="Speak (Windows voice typing)"
      title="Speak: Windows types what you say here (Win+H)"
      disabled={disabled}
      onClick={() => {
        // Windows types into whatever has the focus, so the prompt box takes it first.
        target.current?.focus()
        tellShell("voice")
      }}
    >
      <Icon name="microphone" />
    </button>
  )
}

/** Settings: the switch for the microphone button. */
export function VoiceSetting() {
  const on = useVoiceTyping()
  if (!inShell())
    return (
      <p className="m-0 text-xs text-mut">
        Voice typing is part of the Codehouse window, so there is no microphone button in a browser.
        Win+H still starts Windows voice typing in any text box.
      </p>
    )
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setVoiceTyping(e.target.checked)} />
        <span>Show a microphone beside the prompt box</span>
      </label>
      <p className="m-0 text-xs text-mut">
        It starts Windows voice typing in the prompt box (the same as Win+H), and Windows types what
        you say for you to read before you send it. Windows may send your voice to Microsoft to be
        recognised, so check your organisation allows it before you switch this on. Codehouse itself
        never hears or keeps any audio.
      </p>
    </>
  )
}
