import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { IMPORTED_EVENT } from "./ImportedChats"

interface Counts {
  imported: number
  updated: number
  skipped: number
  redacted: number
  projects: number
  memories: number
}
interface Pending {
  projects: Array<{ id: string; name: string; instructions: string }>
  memories: Array<{ id: string; scope: string; projectId: string | null; text: string }>
}

/**
 * Chats from claude.ai (the owner's Chat build, CH-04): import the export zip claude.ai emails you, into read-only
 * copies here. A project's instructions and the memory that came with it wait for you to accept each one, because
 * they would steer later chats.
 */
export function ClaudeImport() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<
    { counts: Counts; layout: string; skipped: Array<{ what: string; why: string }> } | undefined
  >()
  const [failure, setFailure] = useState<{ error: string; files?: string[] }>()
  const [pending, setPending] = useState<Pending>()

  const load = useCallback(async () => {
    const r = await api<Pending>("GET", "/api/chat/import/pending")
    if (r.ok && r.data) setPending(r.data)
  }, [])
  useEffect(() => void load(), [load])

  const run = async () => {
    setBusy(true)
    setFailure(undefined)
    setResult(undefined)
    const r = await api<{
      ok?: boolean
      cancelled?: boolean
      counts: Counts
      layout: string
      skipped: Array<{ what: string; why: string }>
      files?: string[]
    }>("POST", "/api/chat/import")
    setBusy(false)
    if (r.ok && r.data?.cancelled) return
    if (!r.ok || !r.data) {
      setFailure({
        error: r.error ?? "The import did not finish. Nothing was imported.",
        ...((r as { data?: { files?: string[] } }).data?.files
          ? { files: (r as { data?: { files?: string[] } }).data!.files! }
          : {}),
      })
      return
    }
    setResult({ counts: r.data.counts, layout: r.data.layout, skipped: r.data.skipped })
    window.dispatchEvent(new Event(IMPORTED_EVENT))
    void load()
  }

  const decide = async (url: string, body: object, done: string) => {
    const r = await api("POST", url, body)
    if (!r.ok) return toast.error(r.error ?? "That did not work.", { id: "import" })
    toast(done, { id: "import" })
    void load()
  }

  const waiting = (pending?.projects.length ?? 0) + (pending?.memories.length ?? 0)
  return (
    <div className="grid gap-3">
      <p className="m-0 text-[13px] text-mut">
        In claude.ai, open Settings, then Privacy, and choose Export data. claude.ai emails you a
        link to a zip, which works for 24 hours. Import that zip here: your chats, projects and
        memory become read-only copies on this computer, with your private words taken out first.
        Nothing is sent anywhere.
      </p>
      <p className="m-0 text-[13px] text-mut">
        No Export data in claude.ai? On a Team or Enterprise plan, an owner of the workspace has to
        turn on Allow members to export their own data, under Organization settings, Data and
        privacy.
      </p>
      <div>
        <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? "Importing…" : "Import an export…"}
        </button>
      </div>
      {result ? (
        <p role="status" className="m-0">
          Imported {result.counts.imported}, updated {result.counts.updated} and left{" "}
          {result.counts.skipped} as they were
          {result.counts.redacted ? `; ${result.counts.redacted} private words were taken out` : ""}
          .
          {result.skipped.length
            ? ` ${result.skipped.length} could not be read: ${result.skipped
                .slice(0, 3)
                .map((s) => `${s.what} (${s.why})`)
                .join(", ")}.`
            : ""}
        </p>
      ) : null}
      {failure ? (
        <div role="alert" className="grid gap-1">
          <p className="m-0 font-semibold text-sev">{failure.error}</p>
          {failure.files?.length ? (
            <p className="m-0 text-[13px] text-mut">
              It holds: {failure.files.slice(0, 12).join(", ")}
              {failure.files.length > 12 ? ` and ${failure.files.length - 12} more` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}
      {waiting ? (
        <div className="grid gap-2">
          <h3 className="m-0 text-[14px]">Waiting for you</h3>
          <p className="m-0 text-[13px] text-mut">
            These came with your export. They are not used until you accept them, because they would
            guide later chats.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {pending?.projects.map((p) => (
              <li key={p.id} className="rounded-md border border-line px-3 py-2">
                <span className="block text-[12px] text-mut">
                  Instructions for the project {p.name}
                </span>
                <span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {p.instructions}
                </span>
                <button
                  type="button"
                  className="btn mt-2 !min-h-7"
                  onClick={() =>
                    void decide(
                      "/api/chat/import/accept",
                      { kind: "project", id: p.id },
                      "Instructions accepted",
                    )
                  }
                >
                  Accept
                </button>
              </li>
            ))}
            {pending?.memories.map((m) => (
              <li key={m.id} className="rounded-md border border-line px-3 py-2">
                <span className="block text-[12px] text-mut">
                  Memory, {m.scope === "global" ? "for every chat" : "for one project"}
                </span>
                <span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</span>
                <span className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn !min-h-7"
                    onClick={() =>
                      void decide(
                        "/api/chat/import/accept",
                        { kind: "memory", id: m.id },
                        "Memory accepted",
                      )
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn !min-h-7"
                    onClick={() =>
                      void decide("/api/chat/import/dismiss", { id: m.id }, "Turned down")
                    }
                  >
                    Turn down
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
