import { useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

interface Preview {
  id: string
  files: Record<string, string>
}

/**
 * E-097: a crash bundle to send to whoever is helping, shown first, file by file, exactly as it will be saved. Logs and
 * outcomes, redacted; never inputs, prompts, transcripts or secrets. Saved as a zip in Downloads.
 */
export function CrashBundle() {
  const [preview, setPreview] = useState<Preview>()
  const [busy, setBusy] = useState(false)
  if (import.meta.env.VITE_CODEHOUSE_REMOTE === "cnw") return null
  const make = async () => {
    setBusy(true)
    const r = await api<Preview>("POST", "/api/crash-bundle/preview")
    setBusy(false)
    if (r.ok && r.data) setPreview(r.data)
    else toast.error(r.error ?? "The crash bundle could not be made.", { id: "bundle" })
  }
  const save = async () => {
    if (!preview) return
    setBusy(true)
    const r = await api<{ file: string }>("POST", "/api/crash-bundle", { id: preview.id })
    setBusy(false)
    if (r.ok && r.data) {
      toast(`Saved to ${r.data.file}`, { id: "bundle" })
      setPreview(undefined)
    } else toast.error(r.error ?? "The crash bundle was not saved.", { id: "bundle" })
  }
  if (!preview)
    return (
      <button type="button" className="btn" disabled={busy} onClick={() => void make()}>
        {busy ? "Making the crash bundle" : "Make a crash bundle"}
      </button>
    )
  return (
    <section aria-label="Crash bundle preview" className="panel grid w-full gap-2 p-3">
      <p className="m-0">
        This is everything the crash bundle holds, exactly as it will be saved: logs and outcomes with secrets and your
        redaction list masked, and no inputs, prompts or conversations.
      </p>
      {Object.entries(preview.files).map(([name, text]) => (
        <details key={name}>
          <summary className="mono">
            {name} ({text.length.toLocaleString()} characters)
          </summary>
          <pre className="cmd max-h-64 overflow-auto text-[12.5px]" tabIndex={0}>
            {text}
          </pre>
        </details>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          Save to Downloads
        </button>
        <button type="button" className="btn" onClick={() => setPreview(undefined)}>
          Cancel
        </button>
      </div>
    </section>
  )
}
