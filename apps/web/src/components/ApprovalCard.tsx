import type { PendingView } from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { decide } from "../lib/decide"
import { age, clock, commandText } from "../lib/format"
import { splitByHighlights } from "../lib/highlight"
import { useNow } from "../lib/useNow"
import { send, useStore } from "../store"
import { RiskBadge } from "./RiskBadge"
import { SessionCode } from "./SessionCode"

const COLLAPSE_LINES = 12
const COLLAPSE_CHARS = 1500
const SEP = "\x1f"

interface RememberPreview {
  ok: boolean
  reason?: string
  preview?: string
}

type Panel = "none" | "deny" | "edit" | "remember"

const PHONE_TEXT: Record<PendingView["phone"], string> = {
  none: "Phone not in use",
  held: "Phone: held for quiet hours",
  delivered: "Phone notified",
  expired: "Phone: expired",
}

/** The file or folder an edit-style tool acts on, shown under Where. */
function targetPath(raw: Record<string, unknown>): string | undefined {
  for (const k of ["file_path", "notebook_path", "path"]) {
    const v = raw[k]
    if (typeof v === "string" && v) return v
  }
  return undefined
}

const isShell = (tool: string) => tool === "Bash" || tool === "PowerShell"

export function ApprovalCard({ view }: { view: PendingView }) {
  const req = view.request
  const resolved = useStore((s) => s.resolved[req.id])
  const session = useStore((s) => s.sessions[req.sessionId])
  const now = useNow()
  const root = useRef<HTMLElement>(null)
  const [panel, setPanel] = useState<Panel>("none")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const connected = useStore((s) => s.conn === "open")
  const [remember, setRemember] = useState<RememberPreview>()
  const command = useMemo(
    () => commandText(req.toolName, view.rawInput),
    [req.toolName, view.rawInput],
  )
  const [edited, setEdited] = useState(command)

  useEffect(() => {
    setPanel("none")
    setError(undefined)
    setMessage("")
    setExpanded(false)
    setConfirmStop(false)
    setRemember(undefined)
    setEdited(command)
  }, [req.id, command])

  const segments = (req.verdict.segments ?? [])
    .filter((s) => s.outcome !== "allow")
    .map((s) => s.text)
  const segKey = segments.join(SEP)
  const lines = command.split("\n").length
  const long = lines > COLLAPSE_LINES || command.length > COLLAPSE_CHARS
  const shown =
    long && !expanded
      ? command.split("\n").slice(0, COLLAPSE_LINES).join("\n").slice(0, COLLAPSE_CHARS)
      : command
  const shownParts = useMemo(() => splitByHighlights(shown, segments), [shown, segKey])

  async function run(cmd: Parameters<typeof send>[0]): Promise<boolean> {
    setBusy(true)
    setError(undefined)
    const failed = await decide(cmd)
    setBusy(false)
    if (failed) setError(failed)
    return !failed
  }

  const deny = (msg?: string) =>
    run({ type: "deny", requestId: req.id, ...(msg?.trim() ? { message: msg.trim() } : {}) })
  const allow = () => run({ type: "approve", requestId: req.id })

  async function allowEdited() {
    let updatedInput: Record<string, unknown>
    if (isShell(req.toolName)) {
      updatedInput = { ...view.rawInput, command: edited }
    } else {
      try {
        const v: unknown = JSON.parse(edited)
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object")
        updatedInput = v as Record<string, unknown>
      } catch {
        setError("The input is not valid JSON, so nothing was sent.")
        return
      }
    }
    if (await run({ type: "approve", requestId: req.id, updatedInput }))
      toast("Allowed with your edit. The edited input was checked against the policy again.")
  }

  async function openRemember() {
    setPanel("remember")
    setRemember(undefined)
    const r = await send({ type: "remember_preview", requestId: req.id })
    setRemember(
      r.ok
        ? (r.data as RememberPreview)
        : { ok: false, reason: r.error?.message ?? "Could not work out a rule" },
    )
  }

  async function stopSession() {
    if (await run({ type: "deny", requestId: req.id, message: "The user stopped this session." }))
      await send({ type: "close_session", sessionId: req.sessionId })
  }

  // The chord and Esc work only while focus is inside this card, so a Ctrl+Enter meant to send a
  // prompt can never approve something.
  function onKeyDown(e: React.KeyboardEvent) {
    if (busy || resolved || !connected) return
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && panel === "none") {
      e.preventDefault()
      void allow()
    } else if (e.key === "Escape") {
      e.preventDefault()
      if (panel !== "none") setPanel("none")
      else void deny()
    }
  }

  if (req.kind === "question")
    return <QuestionCard view={view} resolvedSummary={resolved?.summary} />

  const hardDeadline = clock(view.hardDeadline)
  const phoneExpiry = req.expiresAt ? clock(req.expiresAt) : ""
  const title =
    req.kind === "plan"
      ? "Plan ready for approval"
      : isShell(req.toolName)
        ? "Run shell command"
        : req.toolName
  const planText =
    req.kind === "plan" && typeof view.rawInput.plan === "string" ? view.rawInput.plan : undefined

  return (
    <article
      ref={root}
      tabIndex={-1}
      data-approval-card
      onKeyDown={onKeyDown}
      aria-labelledby={`t-${req.id}`}
      className="pass"
    >
      <div className="grid min-w-0 content-start">
        <div className="pass-head">
          <span>
            <span className="lbl">Session</span>
            <span className="val flex items-center gap-2">
              {session ? <SessionCode session={session} className="!text-[16px]" /> : null}
              <span className="font-normal">{req.project}</span>
            </span>
          </span>
          <span>
            <span className="lbl">Waiting</span>
            <span className="val">{age(req.createdAt, now)}</span>
          </span>
          <span className="min-w-0">
            <span className="lbl">Held by rule</span>
            <span className="val mono !text-[14px] [overflow-wrap:anywhere]">
              {req.verdict.ruleId}
            </span>
          </span>
          <span className="ml-auto self-center">
            <RiskBadge risk={req.verdict.risk} className="text-sm" />
          </span>
        </div>
        <div className="grid content-start gap-4 p-5">
          <h2 id={`t-${req.id}`} className="m-0 text-[22px]">
            {title}
          </h2>

          {planText ? (
            <pre className="cmd" tabIndex={0} aria-label="The plan">
              {planText}
            </pre>
          ) : (
            <div>
              <pre className="cmd" tabIndex={0} aria-label="What will run">
                {shownParts.map((p, i) =>
                  p.hit ? (
                    <mark key={i} className="seg">
                      {p.text}
                    </mark>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </pre>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px] text-mut">
                {segments.length > 0 ? (
                  <span>Underlined: the part that caused the escalation.</span>
                ) : (
                  <span>No single part was flagged. The whole input is why it was escalated.</span>
                )}
                {long ? (
                  <button
                    className="btn !min-h-6 !px-2 text-xs"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((v) => !v)}
                  >
                    {expanded
                      ? "Show less"
                      : `Show all (${lines} line${lines === 1 ? "" : "s"}, ${command.length.toLocaleString("en-GB")} characters)`}
                  </button>
                ) : null}
              </div>
            </div>
          )}

          <dl className="m-0 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
            <dt className="text-mut">Where</dt>
            <dd className="m-0 mono [overflow-wrap:anywhere]">
              {req.cwd}
              {targetPath(view.rawInput) ? (
                <span className="block">Target: {targetPath(view.rawInput)}</span>
              ) : null}
            </dd>
            <dt className="text-mut">Why</dt>
            <dd className="m-0">{req.verdict.reason}</dd>
            <dt className="text-mut">Status</dt>
            <dd className="m-0">
              {PHONE_TEXT[view.phone]}
              {phoneExpiry && view.phone !== "none" ? `, expires ${phoneExpiry}` : ""}. Desktop
              times out at {hardDeadline}.
            </dd>
          </dl>

          {panel === "deny" ? (
            <div className="grid gap-2" role="group" aria-label="Deny with a message to Claude">
              <label htmlFor={`m-${req.id}`}>Message to Claude</label>
              <textarea
                id={`m-${req.id}`}
                className="field"
                rows={2}
                maxLength={500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button className="btn btn-deny" disabled={busy} onClick={() => void deny(message)}>
                  Deny with message
                </button>
                <button className="btn" onClick={() => setPanel("none")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {panel === "edit" ? (
            <div className="grid gap-2" role="group" aria-label="Edit then allow">
              <label htmlFor={`e-${req.id}`}>
                {isShell(req.toolName) ? "Command to run instead" : "Input to send instead (JSON)"}
              </label>
              <textarea
                id={`e-${req.id}`}
                className="field mono"
                rows={Math.min(14, Math.max(3, edited.split("\n").length + 1))}
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              <p className="m-0 text-xs text-mut">
                The edited input goes through the policy again. A deny blocks it.
              </p>
              <div className="flex gap-2">
                <button
                  className="btn btn-primary"
                  disabled={busy || edited === command}
                  onClick={() => void allowEdited()}
                >
                  Allow edited input
                </button>
                <button className="btn" onClick={() => setPanel("none")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {panel === "remember" ? (
            <div className="grid gap-2" role="group" aria-label="Remember this decision">
              {!remember ? (
                <p className="m-0 text-mut">Working out the narrowest rule…</p>
              ) : remember.ok ? (
                <>
                  <p className="m-0">This will add exactly one rule to your local policy:</p>
                  <pre className="cmd">{remember.preview}</pre>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() =>
                        void run({ type: "approve", requestId: req.id, remember: true })
                      }
                    >
                      Allow once and remember
                    </button>
                    <button className="btn" onClick={() => setPanel("none")}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="m-0">Nothing can be remembered here. {remember.reason}</p>
                  <div>
                    <button className="btn" onClick={() => setPanel("none")}>
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="m-0 font-semibold text-sev">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <aside aria-label="Decision" className="pass-stub grid content-start gap-2.5 p-5">
        <div role="status" aria-live="polite" className="m-0 font-semibold empty:hidden">
          {resolved ? resolved.summary : ""}
        </div>
        {!connected && !resolved ? (
          <p role="alert" className="m-0 font-semibold text-sev">
            Not connected to the Host. Decisions are paused until it is back.
          </p>
        ) : null}
        {resolved ? null : (
          <>
            <button
              className={clsx(
                "btn w-full justify-between",
                view.defaultToNo ? "btn-primary" : "btn-strong",
              )}
              disabled={busy || !connected}
              onClick={() => void deny()}
            >
              Deny <kbd>Esc</kbd>
            </button>
            <button
              className={clsx(
                "btn w-full justify-between",
                view.defaultToNo ? "btn-strong" : "btn-primary",
              )}
              disabled={busy || !connected}
              onClick={() => void allow()}
              aria-keyshortcuts="Control+Enter"
            >
              {req.kind === "plan" ? "Approve plan" : "Allow once"}{" "}
              <span>
                <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
              </span>
            </button>
            {view.defaultToNo ? (
              <p className="m-0 text-[13px] text-tx">
                Risk is high. Allowing takes a deliberate click or Ctrl+Enter inside this card.
              </p>
            ) : null}
            <hr className="my-1 w-full border-0 border-t border-line" />
            <button
              className="btn w-full"
              disabled={busy || !connected}
              onClick={() => setPanel(panel === "deny" ? "none" : "deny")}
            >
              Deny with message…
            </button>
            {req.kind === "permission" ? (
              <>
                <button
                  className="btn w-full"
                  disabled={busy || !connected}
                  onClick={() => setPanel(panel === "edit" ? "none" : "edit")}
                >
                  Edit then allow…
                </button>
                <button
                  className="btn w-full"
                  disabled={busy || !connected}
                  onClick={() => void openRemember()}
                >
                  Remember…
                </button>
              </>
            ) : null}
            <hr className="my-1 w-full border-0 border-t border-line" />
            {confirmStop ? (
              <div className="grid gap-2" role="group" aria-label="Confirm stopping the session">
                <p className="m-0 text-[13px]">Deny this and end the session?</p>
                <button
                  className="btn btn-deny w-full"
                  disabled={busy || !connected}
                  onClick={() => void stopSession()}
                >
                  Stop session
                </button>
                <button className="btn w-full" onClick={() => setConfirmStop(false)}>
                  Keep session
                </button>
              </div>
            ) : (
              <button
                className="btn w-full"
                disabled={busy || !connected}
                onClick={() => setConfirmStop(true)}
              >
                Stop session…
              </button>
            )}
          </>
        )}
      </aside>
    </article>
  )
}

interface Q {
  question: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

function QuestionCard({ view, resolvedSummary }: { view: PendingView; resolvedSummary?: string }) {
  const qs = (Array.isArray(view.rawInput.questions) ? view.rawInput.questions : []) as Q[]
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const id = view.request.id

  const value = (q: Q) =>
    [
      ...(answers[q.question] ?? []),
      ...(other[q.question]?.trim() ? [other[q.question]!.trim()] : []),
    ].join(", ")
  const complete = qs.length > 0 && qs.every((q) => value(q) !== "")

  async function submit() {
    setBusy(true)
    const out: Record<string, string> = {}
    for (const q of qs) out[q.question] = value(q)
    const r = await send({ type: "answer", requestId: id, answers: out })
    setBusy(false)
    if (!r.ok) setError(r.error?.message ?? "The answer was not accepted")
  }

  return (
    <article
      className="panel grid gap-4 p-5"
      aria-labelledby={`t-${id}`}
      data-approval-card
      tabIndex={-1}
    >
      <h2 id={`t-${id}`} className="m-0 text-base font-semibold">
        Claude is asking you
      </h2>
      {qs.map((q, qi) => (
        <fieldset key={qi} className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 font-semibold">{q.question}</legend>
          {(q.options ?? []).map((o) => {
            const picked = answers[q.question]?.includes(o.label) ?? false
            return (
              <label key={o.label} className="flex cursor-pointer items-start gap-2">
                <input
                  type={q.multiSelect ? "checkbox" : "radio"}
                  name={`q${qi}-${id}`}
                  checked={picked}
                  onChange={() =>
                    setAnswers((a) => {
                      const cur = a[q.question] ?? []
                      return {
                        ...a,
                        [q.question]: q.multiSelect
                          ? picked
                            ? cur.filter((x) => x !== o.label)
                            : [...cur, o.label]
                          : [o.label],
                      }
                    })
                  }
                />
                <span>
                  {o.label}
                  {o.description ? (
                    <span className="block text-xs text-mut">{o.description}</span>
                  ) : null}
                </span>
              </label>
            )
          })}
          <label className="grid gap-1">
            <span className="text-xs text-mut">Or write your own answer</span>
            <input
              className="field"
              maxLength={4000}
              value={other[q.question] ?? ""}
              onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
            />
          </label>
        </fieldset>
      ))}
      {error ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {error}
        </p>
      ) : null}
      {resolvedSummary ? (
        <p role="status" className="m-0 font-semibold">
          {resolvedSummary}
        </p>
      ) : (
        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            disabled={!complete || busy}
            onClick={() => void submit()}
          >
            Send answer
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void send({ type: "deny", requestId: id, message: "The user declined to answer." })
            }
          >
            Decline to answer
          </button>
        </div>
      )}
    </article>
  )
}
