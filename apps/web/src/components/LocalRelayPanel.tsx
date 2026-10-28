import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Status {
  state: "off" | "starting" | "running" | "failed"
  port: number
  publicUrl?: string
  message?: string
  saved: { enabled: boolean; publicUrl: string; port: number } | null
}

/**
 * Run the phone Relay inside JCVC. It runs only while JCVC is running, listens on this computer, and JCVC links
 * itself to it, so there is no token to copy. Your phone still needs an https address that reaches this computer.
 */
export function LocalRelayPanel({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<Status>()
  const [url, setUrl] = useState("")
  const [port, setPort] = useState(8087)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    const r = await api<Status>("GET", "/api/relay/local")
    if (r.ok && r.data) {
      setStatus(r.data)
      if (r.data.saved) {
        setUrl((u) => u || r.data!.saved!.publicUrl)
        setPort(r.data.saved.port)
      }
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const r = await api<Status>("POST", "/api/relay/local/start", { publicUrl: url.trim(), port })
    setBusy(false)
    if (!r.ok) setError(r.error ?? "The Relay did not start")
    else if (r.data?.state === "failed") setError(r.data.message ?? "The Relay did not start")
    else toast("Relay running inside JCVC")
    await load()
    onChanged?.()
  }

  async function stop() {
    setBusy(true)
    await api("POST", "/api/relay/local/stop")
    setBusy(false)
    await load()
    onChanged?.()
  }

  const running = status?.state === "running"
  return (
    <form onSubmit={start} className="panel grid gap-3 p-5" aria-label="Run the Relay inside JCVC">
      <div>
        <h2 className="m-0 text-[18px]">Run the Relay inside JCVC</h2>
        <p className="m-0 mt-1 max-w-[72ch]">
          JCVC can run the phone Relay itself, only while JCVC is running. It links itself to it, so
          there is no token to copy. Your iPhone still needs a secure (https) address that reaches
          this computer.
        </p>
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold">How to get an https address</summary>
        <ul className="m-0 mt-2 grid gap-1 pl-5">
          <li>
            <strong>Tailscale</strong> (simplest if you use it): run{" "}
            <code className="mono">tailscale funnel {port}</code>, then use the address it prints,
            such as <span className="mono">https://my-laptop.tail1234.ts.net</span>.
          </li>
          <li>
            <strong>Cloudflare Tunnel</strong>: point a tunnel at{" "}
            <span className="mono">http://127.0.0.1:{port}</span> and use its https address.
          </li>
          <li>
            Keep the same address once phones are paired; a new address means pairing them again.
          </li>
        </ul>
      </details>
      <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3 max-[700px]:grid-cols-1">
        <label className="grid gap-1">
          <span>Address your phone uses</span>
          <input
            className="field mono"
            type="url"
            required
            placeholder="https://my-laptop.tail1234.ts.net"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={running}
          />
        </label>
        <label className="grid gap-1">
          <span>Port on this computer</span>
          <input
            className="field"
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            disabled={running}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void stop()}>
            Stop the Relay
          </button>
        ) : (
          <button className="btn btn-primary" disabled={busy || !url.trim()}>
            {busy ? "Starting…" : "Start the Relay"}
          </button>
        )}
        <span aria-live="polite" className="sign text-[14px]">
          {status?.state === "running"
            ? `Running on port ${status.port} for ${status.publicUrl}`
            : status?.state === "starting"
              ? "Starting…"
              : status?.state === "failed"
                ? "Not running"
                : "Off"}
        </span>
      </div>
      {error || (status?.state === "failed" && status.message) ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error ?? status?.message}
        </p>
      ) : null}
      <p className="m-0 text-xs text-mut">
        Once it is running, JCVC starts it again each time JCVC starts. Nothing readable passes
        through it: the details are encrypted for your phone only.
      </p>
    </form>
  )
}
