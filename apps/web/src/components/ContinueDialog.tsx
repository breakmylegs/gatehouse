import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { useStore } from "../store"

interface Preview {
  previewId: string
  seed: string
  chars: number
  tokens: number
  summarised: boolean
  summary?: string
  turnsKept: number
  instructionsAvailable: boolean
  memoryAvailable: number
}

/**
 * Trust and continue (the owner's Chat build, CH-07): before an imported chat is carried on here, you see exactly
 * what the new chat will be given (the history, its size and a token estimate, and a summary of the earlier part when
 * it is long) and choose whether the imported project's instructions and memory go with it. Both start unticked.
 */
export function ContinueDialog({
  conversation,
  onClose,
}: {
  conversation: string
  onClose: () => void
}) {
  const [withInstructions, setInstructions] = useState(false)
  const [withMemory, setMemory] = useState(false)
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const selectSession = useStore((s) => s.selectSession)
  const setRoute = useStore((s) => s.setRoute)

  useEffect(() => {
    let live = true
    setPreview(undefined)
    void api<Preview>("POST", "/api/chat/continue/preview", {
      conversation,
      withInstructions,
      withMemory,
    }).then((r) => {
      if (!live) return
      if (r.ok && r.data) setPreview(r.data)
      else setError(r.error ?? "What would be sent could not be put together.")
    })
    return () => {
      live = false
    }
  }, [conversation, withInstructions, withMemory])

  const go = async () => {
    if (!preview) return
    setBusy(true)
    const r = await api<{ sessionId: string }>("POST", "/api/chat/continue", {
      previewId: preview.previewId,
    })
    setBusy(false)
    if (!r.ok || !r.data)
      return toast.error(r.error ?? "The chat could not be started.", { id: "continue" })
    selectSession(r.data.sessionId)
    setRoute("workspace")
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Continue this chat here"
      className="fixed inset-0 z-40 grid place-items-center bg-black/30"
    >
      <div className="panel grid max-h-[85vh] w-[720px] max-w-[94vw] gap-3 overflow-auto p-5">
        <h2 className="m-0 text-[17px]">Continue this chat here</h2>
        <p className="m-0 text-[13.5px]">
          A new chat starts here with this history, given to Claude as a record of what was said,
          not as instructions. Your private words are taken out first. It is not synced to
          claude.ai.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={withInstructions}
            disabled={preview ? !preview.instructionsAvailable : true}
            onChange={(e) => setInstructions(e.target.checked)}
          />
          Bring the imported project's instructions
          {preview && !preview.instructionsAvailable ? (
            <span className="text-mut">(this chat is not in a project)</span>
          ) : null}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={withMemory}
            disabled={preview ? preview.memoryAvailable === 0 : true}
            onChange={(e) => setMemory(e.target.checked)}
          />
          Bring the memory imported from claude.ai
          {preview && preview.memoryAvailable === 0 ? (
            <span className="text-mut">(none imported)</span>
          ) : null}
        </label>
        {error ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            {error}
          </p>
        ) : !preview ? (
          <p className="m-0 text-mut">Putting it together…</p>
        ) : (
          <>
            {preview.summarised ? (
              <div className="grid gap-1 rounded-md border border-line bg-s2 px-3 py-2">
                <span className="text-[12px] font-semibold">
                  Summary of the earlier part, written for this by a separate request
                </span>
                <span className="text-[13.5px]">{preview.summary}</span>
                <span className="text-[12px] text-mut">
                  The last {preview.turnsKept} turns go in word for word.
                </span>
              </div>
            ) : null}
            <p className="m-0 text-[13px]">
              What will be sent: {preview.chars.toLocaleString()} characters, about{" "}
              {preview.tokens.toLocaleString()} tokens.
            </p>
            <pre
              aria-label="What will be sent"
              className="m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md border border-line p-3 text-[12.5px]"
            >
              {preview.seed}
            </pre>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!preview || busy}
            onClick={() => void go()}
          >
            {busy ? "Starting…" : "Trust and continue"}
          </button>
        </div>
      </div>
    </div>
  )
}
