import { useEffect, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { releaseHeld, screenShareOn, setScreenShare, subscribe, watchAndMask } from "../lib/screenshare"
import { onShell, tellShell } from "../lib/shell"

/** E-091: whether screen-share safe mode is on, kept in step with every part of the window. */
export const useScreenShare = () => useSyncExternalStore(subscribe, screenShareOn, () => false)

/**
 * E-091: screen-share safe mode for the whole window. Ctrl+Shift+H or the tray switches it; while it is on, the words on
 * your redaction list are masked wherever the window shows them, pairing codes and push topics are hidden, non-urgent
 * notices wait, and the window app keeps the quick prompt and pop-outs out of captures.
 */
export function ScreenShareControl() {
  const on = useScreenShare()
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault()
        setScreenShare(!screenShareOn())
      }
    }
    window.addEventListener("keydown", key)
    const stop = onShell((m) => m === "screenshare-toggle" && setScreenShare(!screenShareOn()))
    return () => {
      window.removeEventListener("keydown", key)
      stop()
    }
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle("screenshare", on)
    tellShell(on ? "screenshare:on" : "screenshare:off")
    if (!on) {
      const held = releaseHeld()
      if (held.length) toast(`${held.length} notice(s) waited while you shared your screen: ${held.slice(0, 3).join("; ")}`, { id: "screenshare" })
      return
    }
    let stop: (() => void) | undefined
    let gone = false
    void api<{ redactTerms?: string[] }>("GET", "/api/settings").then((r) => {
      if (gone) return
      stop = watchAndMask(document.body, r.ok && r.data?.redactTerms ? r.data.redactTerms : [])
    })
    return () => {
      gone = true
      stop?.()
    }
  }, [on])
  if (!on) return null
  return (
    <div role="status" data-no-mask className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[12.5px] shadow">
      <span className="font-semibold">Screen-share safe mode is on</span>
      <button type="button" className="btn !min-h-6 !px-2 !text-[12px]" onClick={() => setScreenShare(false)}>
        Turn off
      </button>
    </div>
  )
}
