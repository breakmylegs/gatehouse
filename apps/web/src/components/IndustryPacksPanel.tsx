import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

interface Pack {
  file: string
  id?: string
  industry?: string
  title?: string
  status?: string
  rules?: Array<{ id: string; message: string }>
  checklist?: Array<{ id: string; text: string }>
  errors?: string[]
  review?: { by: string; note: string; at: string }
  installed: boolean
}

/** E-092: draft industry packs, signed after your review and only then installable; they can only add caution. */
export function IndustryPacksPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ packs: Pack[]; publicKey?: string; keyTrusted: boolean }>()
  const [open, setOpen] = useState<string>()
  const [by, setBy] = useState("")
  const [note, setNote] = useState("")
  async function load() {
    const x = await send({ type: "industry_packs" })
    if (x.ok) setData(x.data as NonNullable<typeof data>)
    else toast.error(x.error?.message ?? "Not read", { id: "industry" })
  }
  useEffect(() => {
    void load()
  }, [])
  async function sign(id: string) {
    const x = await send({ type: "industry_pack_sign", id, by: by.trim(), note: note.trim() })
    if (!x.ok) return void toast.error(x.error?.message ?? "Not signed", { id: "industry" })
    toast("Signed after your review", { id: "industry" })
    setNote("")
    await load()
  }
  async function install(id: string) {
    const x = await send({ type: "industry_pack_install", id })
    if (!x.ok) return void toast.error(x.error?.message ?? "Not installed", { id: "industry" })
    toast("Installed: its rules now ask before the work it covers", { id: "industry" })
    await load()
  }
  return (
    <section aria-label="Industry packs" className="panel grid gap-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px]">Industry packs</h2>
        <button type="button" className="btn !min-h-7" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="m-0 text-mut">
        Drafts for legal and subject experts to sign off. Each only adds caution: rules that ask or refuse, and checklist items. Review a pack, sign it, then install it.
      </p>
      {data && !data.keyTrusted ? (
        <p className="m-0 font-semibold">
          This computer's signing key is not among the keys you trust (Settings, rule pack keys), so a pack it signs will not install until you trust it.
          {data.publicKey ? (
            <button type="button" className="btn !min-h-6 ml-2" onClick={() => void navigator.clipboard.writeText(data.publicKey!).then(() => toast("Key copied", { id: "industry" }))}>
              Copy the key
            </button>
          ) : null}
        </p>
      ) : null}
      {data?.packs.map((p) => (
        <div key={p.file} className="grid gap-1 border-t border-line pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{p.industry ?? p.file}</strong>
            <span>{p.title}</span>
            <span className="text-mut">{p.installed ? "Installed" : p.review ? `Signed by ${p.review.by}, ${p.review.at.slice(0, 10)}` : "Not signed"}</span>
            {p.id ? (
              <button type="button" className="btn !min-h-7 ml-auto" onClick={() => setOpen(open === p.id ? undefined : p.id)}>
                {open === p.id ? "Hide" : "Review"}
              </button>
            ) : null}
          </div>
          {p.errors ? <span className="font-semibold">Not valid: {p.errors.join("; ")}</span> : null}
          {open === p.id && p.id ? (
            <div className="grid gap-1">
              <span className="text-mut">{p.status}</span>
              <strong>Rules</strong>
              {p.rules?.map((r) => (
                <span key={r.id}>
                  {r.id}: {r.message}
                </span>
              ))}
              <strong>Checklist</strong>
              {p.checklist?.map((c) => (
                <span key={c.id}>{c.text}</span>
              ))}
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1">
                  <span className="text-xs text-mut">Reviewed by</span>
                  <input className="field" value={by} onChange={(e) => setBy(e.target.value)} />
                </label>
                <label className="grid flex-1 gap-1">
                  <span className="text-xs text-mut">What you checked</span>
                  <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <button type="button" className="btn !min-h-7" disabled={!by.trim() || !note.trim()} onClick={() => void sign(p.id!)}>
                  Sign after review
                </button>
                <button type="button" className="btn btn-primary !min-h-7" disabled={!p.review} onClick={() => void install(p.id!)}>
                  Install
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  )
}
