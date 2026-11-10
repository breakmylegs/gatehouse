import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send, useStore } from "../store"

/**
 * D-002: the project's sealed held-out checks, on the desktop only. You add tests no session can read, set the command
 * that runs them, and run them; the session is told only how many passed. The names and the output are shown here and
 * nowhere else.
 */

interface Listing {
  project: string
  names: string[]
  command?: string
}

interface Detail {
  counts?: { passed: number; failed: number; total: number }
  ok: boolean
  timedOut: boolean
  ms: number
  names: string[]
  output: string
}

const countsText = (d: Detail) =>
  d.timedOut
    ? "Held-out checks: the run did not finish in time."
    : d.counts
      ? `Held-out checks: ${d.counts.passed} passed, ${d.counts.failed} failed, of ${d.counts.total}.`
      : `Held-out checks: ${d.ok ? "passed" : "failed"} (the runner gave no counts).`

export function HeldOutPanel({ session }: { session: SessionInfo }) {
  const [list, setList] = useState<Listing>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<Detail>()
  const [command, setCommand] = useState("")
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const load = () =>
    void send({ type: "heldout_list", sessionId: session.id }).then((r) => {
      if (r.ok && r.data) {
        const l = r.data as Listing
        setList(l)
        setCommand(l.command ?? "")
      }
    })
  useEffect(load, [session.id])

  const change = (cmd: Parameters<typeof send>[0], done: string) =>
    void send(cmd).then((r) => {
      if (!r.ok) toast.error(r.error?.message ?? "It was not changed")
      else toast(done)
      load()
    })

  async function run() {
    setBusy(true)
    const r = await send({ type: "heldout_run", sessionId: session.id }, 15 * 60_000)
    setBusy(false)
    if (!r.ok) return void toast.error(r.error?.message ?? "The held-out checks did not run")
    setDetail(r.data as Detail)
  }

  function tellClaude(d: Detail) {
    const text = countsText(d)
    useStore.getState().addUserText(session.id, text)
    void send({ type: "prompt", sessionId: session.id, text }).then((r) => {
      if (!r.ok) toast.error(r.error?.message ?? "It could not be sent")
    })
  }

  return (
    <section aria-labelledby={`ho-${session.id}`}>
      <h3 id={`ho-${session.id}`} className="m-0 mb-1.5 text-[14px]">
        Held-out checks
      </h3>
      <p className="m-0 text-[13px] text-mut">
        {list === undefined
          ? "..."
          : list.names.length
            ? `${list.names.length} sealed for ${list.project}. No session can read them; it is told only how many pass.`
            : `None for ${list.project} yet. Tests you add here are sealed, and no session can read them.`}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn !min-h-7 !text-[13px]"
          disabled={busy || !list?.names.length || !list.command}
          onClick={() => void run()}
        >
          {busy ? "Running" : "Run now"}
        </button>
        <button
          type="button"
          className="btn !min-h-7 !text-[13px]"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Done" : "Manage"}
        </button>
      </div>
      {detail ? (
        <div className="mt-2 grid gap-1.5 rounded border border-line p-2 text-[13px]">
          <strong className={detail.ok ? "text-ok" : "text-sev"}>{countsText(detail)}</strong>
          <p className="m-0 text-mut">
            Shown on this computer only: {detail.names.join(", ")}. Took{" "}
            {Math.round(detail.ms / 1000)} seconds.
          </p>
          <details>
            <summary className="cursor-pointer">The runner's output</summary>
            <pre className="mono m-0 mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-[12px]">
              {detail.output || "(none)"}
            </pre>
          </details>
          <div>
            <button type="button" className="btn !min-h-7 !text-[13px]" onClick={() => tellClaude(detail)}>
              Tell Claude the counts
            </button>
          </div>
        </div>
      ) : null}
      {open ? (
        <div className="mt-2 grid gap-2 text-[13px]">
          <label className="grid gap-0.5">
            <span>The command that runs them, with {"{dir}"} for their folder</span>
            <span className="flex gap-2">
              <input
                className="field mono min-w-0 flex-1 !min-h-7"
                placeholder="npx vitest run {dir}"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              <button
                type="button"
                className="btn !min-h-7"
                disabled={!command.trim() || command === list?.command}
                onClick={() =>
                  change({ type: "heldout_command", sessionId: session.id, command }, "Command saved")
                }
              >
                Save
              </button>
            </span>
          </label>
          {list?.names.length ? (
            <ul className="m-0 grid gap-1 p-0">
              {list.names.map((n) => (
                <li key={n} className="flex items-center justify-between gap-2" style={{ listStyle: "none" }}>
                  <span className="mono truncate">{n}</span>
                  <button
                    type="button"
                    className="btn !min-h-6 !text-[12px]"
                    onClick={() =>
                      change({ type: "heldout_remove", sessionId: session.id, name: n }, `${n} removed`)
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="grid gap-0.5">
            <span>Add a test: its file name</span>
            <input
              className="field mono !min-h-7"
              placeholder="test_hidden.py"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="grid gap-0.5">
            <span>Its contents</span>
            <textarea
              className="field mono min-h-[6rem]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              className="btn btn-primary !min-h-7"
              disabled={!name.trim() || !content.trim()}
              onClick={() => {
                change(
                  { type: "heldout_add", sessionId: session.id, name: name.trim(), content },
                  `${name.trim()} sealed`,
                )
                setName("")
                setContent("")
              }}
            >
              Seal and add
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
