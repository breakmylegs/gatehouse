import type { PendingView } from "@gatehouse/shared/ws-protocol"
import clsx from "clsx"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { age, clock, commandText } from "../lib/format"
import { splitByHighlights } from "../lib/highlight"
import { send, useStore } from "../store"
import { RiskBadge } from "./RiskBadge"

const COLLAPSE_LINES = 12
const SEP = "\x1f"

interface RememberPreview {
  ok: boolean
  reason?: string
  preview?: string
}

type Panel = "none" | "deny" | "edit" | "remember"

function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const PHONE_TEXT: Record<PendingView["phone"], string> = {
  none: "Phone not in use",
  held: "Phone: held for quiet hours",
  delivered: "Phone notified",
  expired: "Phone: expired",
}

const isShell = (tool: string) => tool === "Bash" || tool === "PowerShell"

export function ApprovalCard({ view }: { view: PendingView }) {
  const req = view.request
  const resolved = useStore((s) => s.resolved[req.id])
  const now = useNow()
  const root = useRef<HTMLElement>(null)
  const [panel, setPanel] = useState<Panel>("none")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string>()
  const [expanded, setExpanded] = useState(false)
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
    setRemember(undefined)
    setEdited(command)
  }, [req.id, command])

  const segments = (req.verdict.segments ?? [])
    .filter((s) => s.outcome !== "allow")
    .map((s) => s.text)
  const segKey = segments.join(SEP)
  const lines = command.split("\n").length
  const long = lines > COLLAPSE_LINES
  const shown =
    long && !expanded ? command.split("\n").slice(0, COLLAPSE_LINES).join("\n") : command
  const shownParts = useMemo(() => splitByHighlights(shown, segments), [shown, segKey])

  async function run(cmd: Parameters<typeof send>[0]): Promise<boolean> {
    setBusy(true)
    setError(undefined)
    const r = await send(cmd)
    setBusy(false)
    if (!r.ok) {
      setError(r.error?.message ?? "The Host did not accept that")
      return false
    }
    return true
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
    if (busy || resolved) return
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
      className="panel grid grid-cols-[1fr_250px] max-[1100px]:grid-cols-1"
    >
      <div className="grid content-start gap-4 p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id={`t-${req.id}`} className="m-0 text-base font-semibold">
            {title}
          </h2>
          <span className="text-mut">
            {req.project} · {age(req.createdAt, now)} ago
          </span>
        </div>

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
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-mut">
              {segments.length > 0 ? (
                <span>Underlined: the part that caused the escalation.</span>
              ) : null}
              {long ? (
                <button
                  className="btn !min-h-6 !px-2 text-xs"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded
                    ? "Show less"
                    : `Show all ${lines} lines (${command.length.toLocaleString("en-GB")} characters)`}
                </button>
              ) : null}
            </div>
          </div>
        )}

        <dl className="m-0 grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
          <dt className="text-mut">Where</dt>
          <dd className="m-0 mono [overflow-wrap:anywhere]">{req.cwd}</dd>
          <dt className="text-mut">Rule</dt>
          <dd className="m-0 mono">{req.verdict.ruleId}</dd>
          <dt className="text-mut">Why</dt>
          <dd className="m-0">{req.verdict.reason}</dd>
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
                    onClick={() => void run({ type: "approve", requestId: req.id, remember: true })}
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

      <aside
        aria-label="Decision"
        className="grid content-start gap-2.5 border-l border-line bg-s2 p-5 max-[1100px]:border-l-0 max-[1100px]:border-t"
      >
        <RiskBadge risk={req.verdict.risk} className="justify-self-start" />
        {resolved ? (
          <p role="status" className="m-0 font-semibold">
            {resolved.summary}
          </p>
        ) : (
          <>
            <button
              className="btn btn-deny w-full justify-between"
              disabled={busy}
              onClick={() => void deny()}
            >
              Deny <kbd>Esc</kbd>
            </button>
            <button
              className="btn w-full"
              disabled={busy}
              onClick={() => setPanel(panel === "deny" ? "none" : "deny")}
            >
              Deny with message…
            </button>
            {req.kind === "permission" ? (
              <>
                <button
                  className="btn w-full"
                  disabled={busy}
                  onClick={() => setPanel(panel === "edit" ? "none" : "edit")}
                >
                  Edit then allow…
                </button>
                <button className="btn w-full" disabled={busy} onClick={() => void openRemember()}>
                  Remember…
                </button>
              </>
            ) : null}
            <button className="btn w-full" disabled={busy} onClick={() => void stopSession()}>
              Stop session
            </button>
            <button
              className={clsx("btn btn-primary w-full justify-between")}
              disabled={busy}
              onClick={() => void allow()}
              aria-keyshortcuts="Control+Enter"
            >
              {req.kind === "plan" ? "Approve plan" : "Allow once"}{" "}
              <span>
                <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
              </span>
            </button>
            {view.defaultToNo ? (
              <p className="m-0 text-xs text-mut">
                Risk is high, so nothing here is pre-selected for allowing.
              </p>
            ) : null}
            <p className="m-0 text-xs text-mut">
              {PHONE_TEXT[view.phone]}
              {phoneExpiry && view.phone !== "none" ? `, expires ${phoneExpiry}` : ""}. Desktop
              times out at {hardDeadline}.
            </p>
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
