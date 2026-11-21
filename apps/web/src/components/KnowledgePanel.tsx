import { useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Signed {
  pack: string
  signature: string
  publicKey: string
}

/**
 * D-080: the project's ADRs, glossary settings and CLAUDE.md as a pack signed with this computer's key, to share; and
 * importing one, which applies only when it is signed by a key you trust (Settings, Shared rule packs, Trusted keys)
 * and nothing in it was changed.
 */
export function KnowledgePanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [key, setKey] = useState<string>()
  const [result, setResult] = useState<string>()

  async function exportPack() {
    const r = await send({ type: "knowledge_export", sessionId })
    if (!r.ok) return void toast.error(r.error?.message ?? "It could not be exported", { id: "knowledge" })
    const { signed, files } = r.data as { signed: Signed; files: string[] }
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([JSON.stringify(signed)], { type: "application/json" }))
    a.download = "knowledge.codehouse-pack.json"
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    setKey(signed.publicKey)
    setResult(`Exported ${files.length} file(s), signed with this computer's key.`)
  }

  async function importFile(file: File) {
    let pack: unknown
    try {
      pack = JSON.parse(await file.text())
    } catch {
      return void setResult("That file is not a knowledge pack.")
    }
    const r = await send({ type: "knowledge_import", sessionId, pack: pack as Signed })
    if (!r.ok) return void setResult(`Refused: ${r.error?.message ?? "it did not check out"}`)
    const { written, same } = r.data as { written: string[]; same: string[] }
    setResult(written.length ? `Imported ${written.join(", ")}${same.length ? `; ${same.length} already the same` : ""}.` : "Every file was already the same; nothing changed.")
  }

  return (
    <section aria-label="Knowledge pack" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Knowledge pack</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="m-0 text-mut">
        This project&apos;s decisions (docs/adr), glossary settings and CLAUDE.md or AGENTS.md, signed so another project can
        check where they came from. Claude Code&apos;s settings are never in a pack.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => void exportPack()}>
          Export a signed pack
        </button>
        <label className="btn cursor-pointer">
          Import a pack…
          <input type="file" accept=".json" className="sr-only" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
      </div>
      {result ? <p role="status" className="m-0">{result}</p> : null}
      {key ? (
        <label className="grid gap-1">
          <span>This computer&apos;s public key: whoever imports the pack adds it to their trusted keys first</span>
          <textarea className="field mono" rows={4} readOnly value={key} />
        </label>
      ) : null}
    </section>
  )
}
