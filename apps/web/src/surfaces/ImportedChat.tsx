import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { download } from "../lib/exportMarkdown"
import { groupItems } from "../lib/groups"
import { toItems, toMarkdown, type StoredAttachment, type StoredStep } from "../lib/imported"
import { useStore } from "../store"
import { ContinueDialog } from "../components/ContinueDialog"
import { ItemView, ToolGroup } from "./Workspace"

interface Loaded {
  conversation: {
    id: string
    title: string
    kind: string
    provenance: { kind: string; exportDate?: string }
  }
  steps: StoredStep[]
  attachments: Record<string, StoredAttachment[]>
  artifacts: Array<{
    id: string
    title: string
    type: string
    versions: Array<{ createdAt: string; content: string }>
  }>
}

const day = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "an earlier day"

/**
 * An imported claude.ai chat (the owner's Chat build, CH-05): drawn by the same parts as a native chat, read only.
 * Each of your messages with other versions has arrows to move between them, as in claude.ai. Its artifacts are
 * listed with their versions, shown as text. Export as Markdown saves the branch shown.
 */
export function ImportedChat() {
  const id = useStore((s) => s.importedChat)
  const [data, setData] = useState<Loaded>()
  const [missing, setMissing] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const load = useCallback(async () => {
    if (!id) return
    const r = await api<Loaded>("GET", `/api/chat/conversation?id=${encodeURIComponent(id)}`)
    if (r.ok && r.data) setData(r.data)
    else setMissing(true)
  }, [id])
  useEffect(() => void load(), [load])
  // Message by message, so each one with other versions (edited, or asked again) has its arrows after it.
  const shown = useMemo(
    () =>
      data
        ? data.steps.map((s) => ({ step: s, items: groupItems(toItems([s], data.attachments)) }))
        : [],
    [data],
  )

  if (!id || missing) return <p className="p-6 text-mut">That chat is not here.</p>
  if (!data) return <p className="p-6 text-mut">Loading…</p>
  const c = data.conversation
  const go = async (messageId: string | undefined) => {
    if (!messageId) return
    const r = await api("POST", "/api/chat/conversation/switch", { id: c.id, messageId })
    if (!r.ok) return toast.error(r.error ?? "That version could not be shown.", { id: "imported" })
    void load()
  }
  return (
    <div className="mx-auto grid max-w-[860px] gap-3 p-6">
      {continuing ? (
        <ContinueDialog conversation={c.id} onClose={() => setContinuing(false)} />
      ) : null}
      <h1 className="m-0 text-[20px]">{c.title || "Untitled chat"}</h1>
      <p role="note" className="m-0 rounded-md border border-line bg-s2 px-3 py-2 text-[13.5px]">
        {c.kind === "imported"
          ? `Imported from claude.ai on ${day(c.provenance.exportDate)}. Read-only local copy.`
          : "A chat kept in Codehouse."}
      </p>
      <div className="flex flex-wrap gap-2">
        {c.kind === "imported" ? (
          <button
            type="button"
            className="btn btn-primary !min-h-7"
            onClick={() => setContinuing(true)}
          >
            Continue locally
          </button>
        ) : null}
        {c.kind === "imported" ? (
          <button
            type="button"
            className="btn !min-h-7"
            onClick={async () => {
              // CH-06: in claude.ai itself, in a separate program (Settings, Privacy, Open in Claude).
              const r = await api<{ target: string }>("POST", "/api/chat/handoff", {
                conversation: c.id,
              })
              if (!r.ok)
                return toast.error(r.error ?? "It could not be opened in claude.ai.", {
                  id: "imported",
                })
              toast("Opened in claude.ai", { id: "imported" })
            }}
          >
            Open in Claude
          </button>
        ) : null}
        <button
          type="button"
          className="btn !min-h-7"
          onClick={() =>
            download(
              `${(c.title || "chat").replace(/[\\/:*?"<>|]/g, "_")}.md`,
              toMarkdown(c.title, data.steps),
              "text/markdown",
            )
          }
        >
          Export as Markdown
        </button>
      </div>
      <ol className="m-0 grid list-none gap-3 p-0" aria-label="Conversation">
        {shown.map(({ step, items }) => (
          <li key={step.message.id} className="grid gap-3">
            {items.map((it) =>
              it.kind === "group" ? (
                <ToolGroup key={it.id} tools={it.tools} />
              ) : (
                <ItemView key={it.id} item={it} />
              ),
            )}
            {step.siblings.length > 1 ? (
              <span
                className="branch-nav flex justify-end"
                role="group"
                aria-label={`Version ${step.index + 1} of ${step.siblings.length}`}
              >
                <button
                  type="button"
                  className="copy-btn"
                  aria-label="Show the version before"
                  disabled={step.index === 0}
                  onClick={() => void go(step.siblings[step.index - 1])}
                >
                  ‹
                </button>
                <span aria-hidden="true">
                  {step.index + 1} of {step.siblings.length}
                </span>
                <button
                  type="button"
                  className="copy-btn"
                  aria-label="Show the version after"
                  disabled={step.index === step.siblings.length - 1}
                  onClick={() => void go(step.siblings[step.index + 1])}
                >
                  ›
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {data.artifacts.length ? (
        <section aria-label="Artifacts" className="grid gap-2">
          <h2 className="m-0 text-[15px]">Artifacts</h2>
          {data.artifacts.map((a) => (
            <details key={a.id} className="rounded-md border border-line px-3 py-2">
              <summary>
                {a.title} ({a.versions.length} version{a.versions.length === 1 ? "" : "s"})
              </summary>
              <p className="m-0 mt-1 text-[12px] text-mut">Shown as text: nothing in it runs.</p>
              <pre className="m-0 mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap text-[12.5px]">
                {a.versions.at(-1)?.content}
              </pre>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  )
}
