import { useCallback, useEffect, useRef, useState } from "react"
import { SlackPanel } from "../components/SlackPanel"
import { PushPanel } from "../components/PushPanel"
import { LocalRelayPanel } from "../components/LocalRelayPanel"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useStore } from "../store"

interface Phone {
  id: string
  name: string
  pairedAt: string
}
interface RelayInfo {
  health: { state: "not-configured" | "connected" | "unreachable"; devices: number }
  phones: Phone[]
}
interface Pairing {
  id: string
  code: string
  status: "waiting" | "awaiting-confirmation" | "confirmed" | "expired" | "failed"
  expiresAt: string
  phoneName?: string
  fingerprint?: string
  reason?: string
}

export function Devices({ embedded = false }: { embedded?: boolean } = {}) {
  const [info, setInfo] = useState<RelayInfo>()
  const [error, setError] = useState<string>()
  const health = useStore((s) => s.health?.relay)

  const load = useCallback(async () => {
    const r = await api<RelayInfo>("GET", "/api/relay")
    if (r.ok && r.data) {
      setInfo(r.data)
      setError(undefined)
    } else setError(r.error ?? "Devices could not be read")
  }, [])
  useEffect(() => {
    void load()
  }, [load, health?.state, health?.devices])

  if (error)
    return (
      <p role="alert" className="p-6 font-semibold text-sev">
        {error}
      </p>
    )
  if (!info) return <p className="p-6 text-mut">Loading…</p>

  return (
    <div className="mx-auto grid max-w-[760px] gap-6 p-6">
      {embedded ? null : <h1 className="m-0">Devices and pairing</h1>}
      <PushPanel />
      <SlackPanel />
      {info.health.state === "not-configured" ? (
        <>
          <LocalRelayPanel onChanged={() => void load()} />
          <h2 className="m-0 text-[17px] text-mut">Or connect to a Relay you run elsewhere</h2>
          <Setup onDone={load} />
        </>
      ) : (
        <>
          <p role="status" className="m-0">
            {info.health.state === "connected" ? (
              <>Relay connected. Requests reach your phone and your phone can answer them.</>
            ) : (
              <span className="font-semibold text-sev">
                The Relay cannot be reached. Requests still reach this computer, and decisions on
                this computer still work.
              </span>
            )}
          </p>
          <Phones phones={info.phones} onChanged={load} />
          <AddPhone onPaired={load} />
          <Rotate />
          <LocalRelayPanel onChanged={() => void load()} />
        </>
      )}
    </div>
  )
}

function Setup({ onDone }: { onDone: () => Promise<void> }) {
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [name, setName] = useState("My laptop")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const r = await api("POST", "/api/relay/setup", {
      url: url.trim(),
      enrolToken: token.trim(),
      name,
    })
    setBusy(false)
    if (!r.ok) return setError(r.error ?? "The Relay did not accept that")
    toast("Relay connected")
    await onDone()
  }

  return (
    <form onSubmit={submit} className="panel grid gap-3 p-5" aria-label="Set up the Relay">
      <h2 className="m-0 text-[18px]">Set up the phone relay</h2>
      <p className="m-0">
        To decide from your iPhone as well, run the Relay (on this computer or a server; press F1
        for the steps), then enter its address and the one-time enrolment token it wrote to its data
        folder. Nothing leaves this computer until you do.
      </p>
      <label className="grid gap-1">
        <span>Relay address</span>
        <input
          className="field"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://relay.example.com"
        />
      </label>
      <label className="grid gap-1">
        <span>One-time enrolment token</span>
        <input
          className="field mono"
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="text-[13px] text-mut">
          It works once. The Relay makes a new one for the next device.
        </span>
      </label>
      <label className="grid gap-1">
        <span>Name for this computer</span>
        <input
          className="field"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      <div>
        <button className="btn btn-primary" disabled={busy || !url.trim() || !token.trim()}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  )
}

function Phones({ phones, onChanged }: { phones: Phone[]; onChanged: () => Promise<void> }) {
  const [renaming, setRenaming] = useState<string>()
  const [name, setName] = useState("")
  const [revoking, setRevoking] = useState<string>()
  const [error, setError] = useState<string>()

  async function rename(id: string) {
    const r = await api("PUT", `/api/relay/phones/${id}`, { name })
    if (!r.ok) return setError(r.error ?? "Could not rename it")
    setRenaming(undefined)
    await onChanged()
  }
  async function revoke(id: string) {
    const r = await api<{ relayNotified: boolean }>("DELETE", `/api/relay/phones/${id}`)
    if (!r.ok) return setError(r.error ?? "Could not revoke it")
    setRevoking(undefined)
    toast(
      r.data?.relayNotified
        ? "Phone revoked. It can no longer answer anything."
        : "Phone revoked on this computer. The Relay could not be told, but this computer already refuses its answers.",
    )
    await onChanged()
  }

  return (
    <section aria-label="Paired phones" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Paired phones ({phones.length})</h2>
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {phones.length === 0 ? (
        <p className="m-0 text-mut">No phone is paired yet.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
          {phones.map((p) => (
            <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2">
              {renaming === p.id ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void rename(p.id)
                  }}
                >
                  <label className="sr-only" htmlFor={`rn-${p.id}`}>
                    New name
                  </label>
                  <input
                    id={`rn-${p.id}`}
                    className="field"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                  <button className="btn btn-primary" disabled={!name.trim()}>
                    Save
                  </button>
                  <button type="button" className="btn" onClick={() => setRenaming(undefined)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <span>
                  <strong>{p.name}</strong>
                  <span className="block text-[13px] text-mut">
                    Paired {new Date(p.pairedAt).toLocaleDateString("en-GB")}
                  </span>
                </span>
              )}
              {renaming === p.id ? null : revoking === p.id ? (
                <span
                  role="group"
                  aria-label={`Revoke ${p.name}`}
                  className="flex items-center gap-2"
                >
                  <span>Stop this phone answering?</span>
                  <button className="btn btn-deny" onClick={() => void revoke(p.id)}>
                    Revoke
                  </button>
                  <button className="btn" onClick={() => setRevoking(undefined)} autoFocus>
                    Keep
                  </button>
                </span>
              ) : (
                <span className="flex gap-2">
                  <button
                    className="btn"
                    onClick={() => {
                      setRenaming(p.id)
                      setName(p.name)
                    }}
                  >
                    Rename
                  </button>
                  <button className="btn" onClick={() => setRevoking(p.id)}>
                    Revoke…
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AddPhone({ onPaired }: { onPaired: () => Promise<void> }) {
  const [pairing, setPairing] = useState<Pairing>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)

  const stop = () => clearInterval(timer.current)
  useEffect(() => stop, [])

  async function start() {
    setBusy(true)
    setError(undefined)
    const r = await api<Pairing>("POST", "/api/relay/pairing")
    setBusy(false)
    if (!r.ok || !r.data) return setError(r.error ?? "Could not start pairing")
    setPairing(r.data)
    stop()
    const id = r.data.id
    timer.current = setInterval(async () => {
      const s = await api<Pairing>("GET", `/api/relay/pairing/${id}`)
      if (s.ok && s.data) {
        setPairing(s.data)
        if (s.data.status !== "waiting") stop()
      }
    }, 2000)
  }

  async function confirm() {
    if (!pairing) return
    const r = await api("POST", `/api/relay/pairing/${pairing.id}/confirm`)
    if (!r.ok) return setError(r.error ?? "Could not confirm")
    toast("Phone paired")
    setPairing(undefined)
    await onPaired()
  }

  async function cancel() {
    stop()
    if (pairing) await api("DELETE", `/api/relay/pairing/${pairing.id}`)
    setPairing(undefined)
  }

  return (
    <section aria-label="Add a phone" className="panel grid gap-3 p-5">
      <h2 className="m-0 text-[18px]">Add a phone</h2>
      {!pairing ? (
        <>
          <p className="m-0">
            On the iPhone, open the Relay address in Safari, tap Share, then Add to Home Screen, and
            open the new icon. It asks for the code this page shows.
          </p>
          <div>
            <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
              {busy ? "Starting…" : "Show a pairing code"}
            </button>
          </div>
        </>
      ) : pairing.status === "waiting" ? (
        <>
          <p className="m-0">Enter this code in the app on your iPhone. It works for 5 minutes.</p>
          <p
            className="mono m-0 text-[32px] font-semibold tracking-[0.2em]"
            aria-label={`Pairing code ${pairing.code.split("").join(" ")}`}
          >
            {pairing.code}
          </p>
        </>
      ) : pairing.status === "awaiting-confirmation" ? (
        <>
          <p className="m-0">
            <strong>{pairing.phoneName}</strong> is ready. Does the phone show these six digits?
          </p>
          <p
            className="mono m-0 text-[32px] font-semibold tracking-[0.2em]"
            aria-label={`Fingerprint ${pairing.fingerprint?.split("").join(" ")}`}
          >
            {pairing.fingerprint}
          </p>
          <p className="m-0 text-[13px] text-mut">
            If the digits differ, do not confirm. Someone else may be answering the pairing.
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => void confirm()}>
              They match, pair this phone
            </button>
            <button className="btn" onClick={() => void cancel()}>
              They differ, cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p role="alert" className="m-0 font-semibold text-sev">
            {pairing.status === "expired"
              ? "The code expired. Start again."
              : (pairing.reason ?? "Pairing failed. Start again.")}
          </p>
          <div>
            <button className="btn" onClick={() => void cancel()}>
              Close
            </button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {pairing && pairing.status === "waiting" ? (
        <div>
          <button className="btn" onClick={() => void cancel()}>
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  )
}

function Rotate() {
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState<string>()
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const r = await api("POST", "/api/relay/rotate-token")
    setBusy(false)
    setConfirm(false)
    setMsg(
      r.ok
        ? "Done. The Relay now accepts only the new token, which this computer keeps protected."
        : (r.error ?? "The token was not changed."),
    )
  }
  return (
    <section aria-label="Device token" className="grid gap-2">
      <h2 className="m-0 text-[18px]">Device token</h2>
      <p className="m-0 text-mut">
        This computer proves itself to the Relay with a token. Rotate it if you think it has been
        seen. Paired phones are not affected.
      </p>
      {confirm ? (
        <div
          role="group"
          aria-label="Confirm rotating the device token"
          className="flex items-center gap-2"
        >
          <button className="btn btn-primary" disabled={busy} onClick={() => void go()}>
            {busy ? "Rotating…" : "Rotate now"}
          </button>
          <button className="btn" onClick={() => setConfirm(false)} autoFocus>
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button className="btn" onClick={() => setConfirm(true)}>
            Rotate device token…
          </button>
        </div>
      )}
      {msg ? (
        <p role="status" className="m-0 font-semibold">
          {msg}
        </p>
      ) : null}
    </section>
  )
}
