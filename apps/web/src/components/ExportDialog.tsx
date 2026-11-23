import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api } from "../lib/api"
import { download, exportName, toMarkdown } from "../lib/exportMarkdown"
import { emptyTranscript, reduceHistory, type Item } from "../lib/transcript"
import { send, useStore } from "../store"
import { modelLabel } from "../lib/models"

/** What to export: a conversation by its Claude Code id, or an open session not yet saved by Claude Code. */
export interface ExportWhat {
  title: string
  cwd?: string
  sdkSessionId?: string
  sessionId?: string
}

/** Opens the Export dialog from anywhere (the session menu, the sidebar, Earlier sessions). */
export const openExport = (what: ExportWhat) =>
  window.dispatchEvent(new CustomEvent<ExportWhat>(EXPORT_EVENT, { detail: what }))
const EXPORT_EVENT = "codeh:export"

type Format = "md" | "html" | "pdf" | "docx" | "pptx" | "xlsx"
const FORMATS: Array<{ id: Format; label: string }> = [
  { id: "md", label: "Markdown (.md)" },
  { id: "html", label: "Web page (.html)" },
  { id: "pdf", label: "PDF, through the print window" },
  // E-081: made by the Host from the text shown, marked as AI-generated.
  { id: "docx", label: "Word (.docx)" },
  { id: "pptx", label: "PowerPoint (.pptx)" },
  { id: "xlsx", label: "Excel (.xlsx), its tables" },
]
const OFFICE = new Set<Format>(["docx", "pptx", "xlsx"])

/** Saves a file the Host made, sent as base64. */
function downloadBytes(name: string, base64: string, mime: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** A standalone page of the redacted Markdown, for HTML and for printing to PDF. */
export function htmlPage(title: string, markdown: string): string {
  const body = renderToStaticMarkup(<Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>)
  const esc = title.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  )
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc}</title><style>
body{font:15px/1.55 "Segoe UI",system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#0f172a}
pre,code{font-family:"Cascadia Mono",Consolas,monospace}pre{background:#f1f5f9;border:1px solid #d9e0ea;border-radius:6px;padding:10px;white-space:pre-wrap;break-inside:avoid}
blockquote{border-left:3px solid #d9e0ea;margin:0;padding-left:12px;color:#475569}table{border-collapse:collapse}td,th{border:1px solid #d9e0ea;padding:4px 8px}
</style></head><body>${body}</body></html>`
}

/** Opens the print window on a page, where Save as PDF is one of the printers. */
function printPage(html: string): void {
  const frame = document.createElement("iframe")
  frame.style.position = "fixed"
  frame.style.width = "0"
  frame.style.height = "0"
  frame.style.border = "0"
  frame.srcdoc = html
  frame.onload = () => {
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.appendChild(frame)
}

interface Preview {
  text: string
  masked: number
  /** E-081: an Office file the Host made, as base64 (an older Host sends none). */
  file?: string
  mime?: string
  /** E-085: a workbook's formulas and their checks. */
  formulas?: { verified: number; notVerified: number; mismatches: string[] }
  /** E-086: writing-rule corrections made to the prose (an older Host sends none). */
  changes?: Array<{ from: string; to: string; count: number }>
  banned?: string[]
}

const shown = (s: string) => (s === "—" ? "an em dash" : s === "–" ? "an en dash" : `"${s}"`)

/** E-086: what the writing rules corrected, and banned terms left for you to change. */
export function WritingChanges({ changes, banned }: { changes: NonNullable<Preview["changes"]>; banned: string[] }) {
  if (!changes.length && !banned.length) return null
  return (
    <div className="grid gap-1 text-[13px]">
      {changes.length ? (
        <>
          <span>Corrected by your writing rules:</span>
          <ul className="m-0 pl-5">
            {changes.slice(0, 20).map((c) => (
              <li key={`${c.from}>${c.to}`}>
                {shown(c.from)} to "{c.to}"{c.count > 1 ? `, ${c.count} times` : ""}
              </li>
            ))}
            {changes.length > 20 ? <li className="text-mut">and {changes.length - 20} more</li> : null}
          </ul>
        </>
      ) : null}
      {banned.length ? (
        <span className="font-semibold text-warn">
          Banned by your writing rules, and left for you to change: {banned.map((b) => `"${b}"`).join(", ")}.
        </span>
      ) : null}
    </div>
  )
}

/**
 * Export with a preview (W1-13): the whole conversation is read from the Host from its start, your redaction list
 * and secret patterns are masked by the Host, and what you see is exactly what is saved. Each save is in the audit
 * log.
 */
export function ExportDialog() {
  const [what, setWhat] = useState<ExportWhat>()
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState<string>()
  const [format, setFormat] = useState<Format>("md")
  const [busy, setBusy] = useState(false)
  const id = useId()
  const back = useRef<HTMLElement | null>(null)
  const markdown = useRef("")
  useEffect(() => {
    const open = (e: Event) => {
      back.current = document.activeElement as HTMLElement | null
      setPreview(undefined)
      setError(undefined)
      setFormat("md")
      setWhat((e as CustomEvent<ExportWhat>).detail)
    }
    window.addEventListener(EXPORT_EVENT, open)
    return () => window.removeEventListener(EXPORT_EVENT, open)
  }, [])
  useEffect(() => {
    if (!what) return
    let gone = false
    void (async () => {
      let items: Item[] = []
      if (what.sdkSessionId) {
        const r = await send(
          {
            type: "history_messages",
            sdkSessionId: what.sdkSessionId,
            all: true,
            ...(what.cwd ? { cwd: what.cwd } : {}),
          },
          120_000,
        )
        if (r.ok && Array.isArray(r.data)) {
          let t = emptyTranscript()
          for (const m of r.data as unknown[]) t = reduceHistory(t, m)
          items = t.items.map(({ at: _at, ...rest }) => rest) as Item[]
        }
      }
      // Not saved by Claude Code yet (a session still starting): what is on screen.
      if (!items.length && what.sessionId)
        items = useStore.getState().transcripts[what.sessionId]?.items ?? []
      const model = what.sessionId ? useStore.getState().sessions[what.sessionId]?.model : undefined
      markdown.current = toMarkdown(items, {
        title: what.title,
        ...(what.cwd ? { cwd: what.cwd } : {}),
        at: Date.now(),
        ...(model ? { model: modelLabel(model, model) } : {}),
      })
      const p = await api<Preview>("POST", "/api/export/redact", {
        text: markdown.current,
        format: "md",
        title: what.title,
        preview: true,
        ...(what.sessionId ? { session: what.sessionId } : {}),
      })
      if (gone) return
      if (p.ok && p.data) setPreview(p.data)
      else setError(p.error ?? "The conversation could not be read.")
    })()
    return () => {
      gone = true
    }
  }, [what])
  if (!what) return null
  const close = () => {
    setWhat(undefined)
    back.current?.focus?.()
  }
  async function save() {
    if (!what) return
    setBusy(true)
    const r = await api<Preview>("POST", "/api/export/redact", {
      text: markdown.current,
      format,
      title: what.title,
      ...(what.sessionId ? { session: what.sessionId } : {}),
    })
    setBusy(false)
    if (!r.ok || !r.data) {
      setError(r.error ?? "The export was not made.")
      return
    }
    const name = exportName(what.title, Date.now())
    if (OFFICE.has(format)) {
      if (!r.data.file || !r.data.mime) {
        setError("This version of Codehouse's Host cannot make Office files. Restart Codehouse after updating.")
        return
      }
      downloadBytes(name.replace(/\.md$/, `.${format}`), r.data.file, r.data.mime)
      const fx = r.data.formulas
      if (fx?.mismatches.length) {
        setError(`Saved. Its totals are formulas; ${fx.mismatches.length} differ from what the text said (see the Formula checks sheet): ${fx.mismatches.slice(0, 3).join("; ")}`)
        return
      }
    } else if (format === "md") download(name, r.data.text, "text/markdown")
    else if (format === "html")
      download(name.replace(/\.md$/, ".html"), htmlPage(what.title, r.data.text), "text/html")
    else printPage(htmlPage(what.title, r.data.text))
    close()
  }
  return createPortal(
    <div className="picture-viewer !cursor-default" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        className="panel grid max-h-[90vh] w-[min(820px,94vw)] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-3 p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            close()
          }
        }}
      >
        <h2 id={`${id}-h`} className="m-0 text-[17px]">
          Export {what.title}
        </h2>
        <p role="status" className="m-0 text-[13.5px]">
          {error
            ? error
            : !preview
              ? "Reading the whole conversation…"
              : preview.masked
                ? `${preview.masked} ${preview.masked === 1 ? "thing was" : "things were"} masked: words on your redaction list and anything that looks like a secret. This is exactly what will be saved.`
                : "Nothing needed masking. This is exactly what will be saved."}
          {preview && OFFICE.has(format) ? " The Office file starts with a line, and carries in its properties, that it is AI-generated." : ""}
        </p>
        <WritingChanges changes={preview?.changes ?? []} banned={preview?.banned ?? []} />
        <pre
          className="cmd min-h-0 overflow-auto text-[12.5px]"
          aria-label="What will be saved"
          tabIndex={0}
        >
          {preview?.text ?? ""}
        </pre>
        <div className="flex flex-wrap items-center gap-3">
          <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
            <legend className="sr-only">Format</legend>
            {FORMATS.map((f) => (
              <label key={f.id} className="flex items-center gap-1.5 text-[13.5px]">
                <input
                  type="radio"
                  name={`${id}-f`}
                  checked={format === f.id}
                  onChange={() => setFormat(f.id)}
                />
                {f.label}
              </label>
            ))}
          </fieldset>
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!preview || busy}
              onClick={() => void save()}
            >
              {format === "pdf" ? "Print to PDF" : "Save"}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
