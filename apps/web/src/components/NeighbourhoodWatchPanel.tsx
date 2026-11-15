import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Status {
  paired: boolean
  on: boolean
  url?: string
  state: "off" | "connecting" | "connected" | "refused"
}

const STATE: Record<Status["state"], string> = {
  off: "Off",
  connecting: "Connecting",
  connected: "Connected",
  refused: "Refused: pair this computer again",
}

/**
 * O41: Settings, Neighbourhood Watch. Pair this computer with your Codehouse Neighbourhood Watch server (its address and
 * the one-time code it shows), turn it on or off, or unpair. Codehouse connects out to it; nothing here listens.
 */
export function NeighbourhoodWatchPanel() {
  const [s, setS] = useState<Status>()
  const [url, setUrl] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const r = await api<Status>("GET", "/api/cnw")
    if (r.ok && r.data) setS(r.data)
  }
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [])

  async function pair(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = await api<Status>("POST", "/api/cnw/pair", { url, code })
    setBusy(false)
    if (!r.ok || !r.data) return void toast.error(r.error ?? "It could not pair.", { id: "cnw" })
    setS(r.data)
    setCode("")
    toast("Paired with Neighbourhood Watch.", { id: "cnw" })
  }

  if (!s) return <p className="m-0 text-mut">Reading...</p>
  if (!s.paired)
    return (
      <form className="grid gap-2" onSubmit={(e) => void pair(e)}>
        <p className="m-0 text-xs text-mut">
          Neighbourhood Watch is a server you run at home (docker compose) that shows this computer&apos;s sessions in a
          browser, a tablet or a phone, where you can approve and send prompts as here. Codehouse connects out to it, so
          nothing needs a port opened. Make a pairing code on its page, then enter its address and the code here.
        </p>
        <label className="grid gap-1">
          <span>Its address</span>
          <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cnw.home.arpa" required />
        </label>
        <label className="grid gap-1">
          <span>Pairing code</span>
          <input className="field mono w-40" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7M2-9QXP" required />
        </label>
        <button className="btn btn-primary w-fit" disabled={busy}>
          {busy ? "Pairing..." : "Pair this computer"}
        </button>
      </form>
    )
  return (
    <div className="grid gap-2">
      <p className="m-0">
        Paired with <span className="mono">{s.url}</span>: <strong>{STATE[s.state]}</strong>
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={s.on}
          onChange={async (e) => {
            const r = await api<Status>("POST", "/api/cnw/on", { on: e.target.checked })
            if (r.ok && r.data) setS(r.data)
            else toast.error(r.error ?? "Not changed.", { id: "cnw" })
          }}
        />
        Share this computer&apos;s sessions with Neighbourhood Watch
      </label>
      <p className="m-0 text-xs text-mut">
        Anyone signed in there can see this computer&apos;s sessions, approve, answer and send prompts, as at this desk.
        Every check here still applies, each decision from there is recorded as from Neighbourhood Watch, and a Severe
        approval needs someone signed in.
      </p>
      <button
        type="button"
        className="btn w-fit"
        onClick={async () => {
          if (!confirm("Unpair this computer? Neighbourhood Watch will no longer see it until you pair again.")) return
          const r = await api<Status>("DELETE", "/api/cnw")
          if (r.ok && r.data) setS(r.data)
        }}
      >
        Unpair
      </button>
    </div>
  )
}
