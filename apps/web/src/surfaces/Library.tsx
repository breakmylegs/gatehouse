import clsx from "clsx"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

type Section = "floor" | "deny" | "escalate" | "allow"
type YourSection = "allow" | "escalate" | "deny"

interface Rule {
  id: string
  tools?: string[]
  exceptTools?: string[]
  commands?: string[]
  pathGlobs?: string[]
  pathInside?: "workspaceRoots"
  pathOutside?: "workspaceRoots"
  everySegmentMustMatch?: true
  risk?: number
  message?: string
  [k: string]: unknown
}

interface UserRules {
  version: 1
  packs?: string[]
  disabled?: string[]
  allow?: Rule[]
  escalate?: Rule[]
  deny?: Rule[]
}

interface LibraryData {
  path: string | null
  errors: string[]
  packs: Array<{
    id: string
    title: string
    description: string
    on: boolean
    rules: Array<{ id: string; section: YourSection; rule: Rule; off: boolean }>
    cases: Array<{ tool: string; input: Record<string, unknown>; expect: string; note?: string }>
  }>
  base: Array<{ id: string; section: Section; rule: Rule; off: boolean; fixed: boolean }>
  user: UserRules
}

interface Preview {
  total: number
  changes: Array<{
    line: number
    summary: string
    before: { outcome: string; ruleId: string }
    after: { outcome: string; ruleId: string }
    outcomeChanged: boolean
  }>
}

const SECTION_LABEL: Record<Section, string> = {
  floor: "Always blocked",
  deny: "Blocked",
  escalate: "Asks you",
  allow: "Goes through",
}

const OUTCOME: Record<string, string> = { allow: "allowed", deny: "denied", escalate: "asked you" }

function summary(r: Rule): string {
  const bits: string[] = []
  if (r.tools) bits.push(`tools: ${r.tools.join(", ")}`)
  if (r.commands)
    bits.push(
      `commands: ${r.commands.slice(0, 6).join(", ")}${r.commands.length > 6 ? `, and ${r.commands.length - 6} more` : ""}`,
    )
  if (r.pathGlobs) bits.push(`files: ${r.pathGlobs.join(", ")}`)
  if (r.pathInside) bits.push("inside your folders")
  if (r.pathOutside) bits.push("outside your folders")
  return bits.join("; ")
}

function exampleText(input: Record<string, unknown>): string {
  const v = input.command ?? input.file_path ?? input.url
  return typeof v === "string" ? v : JSON.stringify(input)
}

const clean = (u: UserRules): UserRules => {
  const out: UserRules = { version: 1 }
  if (u.packs?.length) out.packs = [...u.packs].sort()
  if (u.disabled?.length) out.disabled = [...u.disabled].sort()
  for (const s of ["allow", "escalate", "deny"] as const) if (u[s]?.length) out[s] = u[s]
  return out
}

/** The rule library: packs you can switch on, built-in rules you can switch off or copy, and rules of your own. */
export function Library() {
  const [data, setData] = useState<LibraryData>()
  const [draft, setDraft] = useState<UserRules>({ version: 1 })
  const [error, setError] = useState<string>()
  const [errors, setErrors] = useState<string[]>()
  const [preview, setPreview] = useState<Preview>()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{
    section: YourSection
    rule: Rule
    originalId?: string
  }>()

  const load = useCallback(async () => {
    const r = await api<LibraryData>("GET", "/api/library")
    if (r.ok && r.data) {
      setData(r.data)
      setDraft(clean(r.data.user))
      setError(undefined)
    } else setError(r.error ?? "The rule library could not be read")
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(
    () => data !== undefined && JSON.stringify(clean(draft)) !== JSON.stringify(clean(data.user)),
    [data, draft],
  )

  if (error)
    return (
      <p role="alert" className="font-semibold text-sev">
        {error}
      </p>
    )
  if (!data) return <p className="text-mut">Loading…</p>

  const packOn = (id: string) => draft.packs?.includes(id) ?? false
  const isOff = (id: string) => draft.disabled?.includes(id) ?? false
  const toggle = (list: "packs" | "disabled", id: string) => {
    setPreview(undefined)
    setDraft((d) => {
      const cur = d[list] ?? []
      return { ...d, [list]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }
    })
  }
  const mine = (["allow", "escalate", "deny"] as const).flatMap((section) =>
    (draft[section] ?? []).map((rule) => ({ section, rule })),
  )
  const copy = (section: Section, rule: Rule) => {
    const target: YourSection = section === "floor" ? "deny" : section
    const { id, ...rest } = rule
    setEditing({ section: target, rule: { ...rest, id: id.startsWith("my-") ? id : `my-${id}` } })
  }
  const saveRule = (section: YourSection, rule: Rule, originalId?: string) => {
    setPreview(undefined)
    setDraft((d) => {
      const next: UserRules = { ...d }
      for (const s of ["allow", "escalate", "deny"] as const)
        next[s] = (next[s] ?? []).filter((r) => r.id !== (originalId ?? rule.id))
      next[section] = [...(next[section] ?? []), rule]
      return next
    })
    setEditing(undefined)
  }
  const removeRule = (id: string) => {
    setPreview(undefined)
    setDraft((d) => {
      const next: UserRules = { ...d }
      for (const s of ["allow", "escalate", "deny"] as const)
        next[s] = (next[s] ?? []).filter((r) => r.id !== id)
      return next
    })
  }

  async function runPreview() {
    setBusy(true)
    setErrors(undefined)
    const r = await api<Preview>("POST", "/api/library/preview", clean(draft))
    setBusy(false)
    if (r.ok && r.data) setPreview(r.data)
    else setErrors(r.errors ?? [r.error ?? "The preview did not run"])
  }
  async function save() {
    setBusy(true)
    setErrors(undefined)
    const r = await api<{ changed: string[] }>("PUT", "/api/library", clean(draft))
    setBusy(false)
    if (!r.ok) {
      setErrors(r.errors ?? [r.error ?? "Not saved"])
      return
    }
    toast("Rules saved and in force")
    setPreview(undefined)
    await load()
  }

  return (
    <div className="grid gap-6">
      <p className="m-0 max-w-[72ch] text-mut">
        Switch on packs of ready-made rules, switch off built-in rules you do not want, and keep
        rules of your own. Nothing changes until you save. The floor (always blocked) and the deny
        rules always apply and cannot be switched off.
      </p>
      {data.errors.length ? (
        <ul role="alert" className="m-0 text-sev">
          {data.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <section aria-label="Packs" className="grid gap-2">
        <h2 className="m-0 text-[19px]">Packs</h2>
        <div className="grid gap-2">
          {data.packs.map((p) => (
            <details key={p.id} className={clsx("panel", packOn(p.id) && "ring-1 ring-acc")}>
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={packOn(p.id)}
                  onChange={() => toggle("packs", p.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Switch on ${p.title}`}
                />
                <span className="grid min-w-0 gap-0.5">
                  <span className="sign text-[16px] font-semibold">{p.title}</span>
                  <span className="text-[13px] text-mut">{p.description}</span>
                </span>
                <span className="sign ml-auto shrink-0 text-[13px] text-mut">
                  {p.rules.length} rule{p.rules.length === 1 ? "" : "s"}, show
                </span>
              </summary>
              <div className="grid gap-3 border-t border-line px-4 py-3">
                <ul className="m-0 grid list-none gap-2 p-0">
                  {p.rules.map((r) => (
                    <li key={r.id} className="grid gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="mono text-[13px]">{r.id}</span>
                        <span className="sign text-[12.5px] text-mut">
                          {SECTION_LABEL[r.section]}
                        </span>
                        <button
                          type="button"
                          className="btn ml-auto !min-h-7 !px-2 text-[13px]"
                          onClick={() => copy(r.section, r.rule)}
                        >
                          Copy to my rules
                        </button>
                      </span>
                      <span className="text-[13px] text-mut">{summary(r.rule)}</span>
                    </li>
                  ))}
                </ul>
                {p.cases.length ? (
                  <div>
                    <span className="lbl mb-1">Examples with this pack on</span>
                    <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
                      {p.cases.map((c, i) => (
                        <li key={i}>
                          <span className="mono">{exampleText(c.input)}</span>{" "}
                          <span className="text-mut">is {OUTCOME[c.expect] ?? c.expect}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section aria-label="Built-in rules" className="grid gap-2">
        <h2 className="m-0 text-[19px]">Built-in rules</h2>
        <table className="panel w-full border-separate border-spacing-0 overflow-hidden text-left">
          <caption className="sr-only">The rules JCVC ships with</caption>
          <thead>
            <tr className="sign text-[12.5px] font-medium text-mut">
              <th className="border-b border-line px-4 py-2 font-medium">Rule</th>
              <th className="border-b border-line px-4 py-2 font-medium">What it does</th>
              <th className="border-b border-line px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.base.map((r) => (
              <tr key={r.id} className={clsx(isOff(r.id) && "opacity-60")}>
                <td className="border-b border-line px-4 py-2 align-top">
                  <span className="mono block text-[13px]">{r.id}</span>
                  <span className="sign block text-[12.5px] text-mut">
                    {SECTION_LABEL[r.section]}
                  </span>
                </td>
                <td className="border-b border-line px-4 py-2 align-top text-[13px]">
                  {summary(r.rule)}
                  {r.rule.message ? <span className="block text-mut">{r.rule.message}</span> : null}
                </td>
                <td className="border-b border-line px-4 py-2 text-right align-top">
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    {r.fixed ? (
                      <span className="sign text-[13px] text-mut">Always applies</span>
                    ) : (
                      <button
                        type="button"
                        className="btn !min-h-7 !px-2 text-[13px]"
                        onClick={() => toggle("disabled", r.id)}
                      >
                        {isOff(r.id) ? "Switch back on" : "Switch off"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn !min-h-7 !px-2 text-[13px]"
                      onClick={() => copy(r.section, r.rule)}
                    >
                      Copy to my rules
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Your rules" className="grid gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="m-0 text-[19px]">Your rules</h2>
          <button
            type="button"
            className="btn ml-auto"
            onClick={() =>
              setEditing({
                section: "allow",
                rule: { id: "my-", commands: [""], everySegmentMustMatch: true },
              })
            }
          >
            Add a rule
          </button>
        </div>
        {mine.length === 0 && !editing ? (
          <p className="m-0 text-mut">None yet. Copy a rule above to start from it, or add one.</p>
        ) : null}
        <ul className="m-0 grid list-none gap-2 p-0">
          {mine.map(({ section, rule }) => (
            <li key={rule.id} className="panel flex flex-wrap items-start gap-3 px-4 py-3">
              <span className="grid min-w-0 gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="mono text-[13px]">{rule.id}</span>
                  <span className="sign text-[12.5px] text-mut">{SECTION_LABEL[section]}</span>
                </span>
                <span className="text-[13px] text-mut">{summary(rule)}</span>
              </span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  className="btn !min-h-7 !px-2 text-[13px]"
                  onClick={() => setEditing({ section, rule, originalId: rule.id })}
                >
                  Change
                </button>
                <button
                  type="button"
                  className="btn !min-h-7 !px-2 text-[13px]"
                  onClick={() => removeRule(rule.id)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        {editing ? (
          <RuleEditor
            key={editing.originalId ?? editing.rule.id}
            initial={editing}
            onCancel={() => setEditing(undefined)}
            onSave={(section, rule) => saveRule(section, rule, editing.originalId)}
          />
        ) : null}
      </section>

      <div className="sticky bottom-0 grid gap-2 border-t border-line bg-bg py-3">
        {errors?.length ? (
          <ul role="alert" className="m-0 font-semibold text-sev">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {preview ? (
          <div role="status" className="panel grid gap-1 px-4 py-3">
            <strong className="sign">
              {preview.changes.filter((c) => c.outcomeChanged).length} of {preview.total} past
              decisions would come out differently
            </strong>
            <ul className="m-0 grid list-none gap-0.5 p-0 text-[13px]">
              {preview.changes
                .filter((c) => c.outcomeChanged)
                .slice(0, 8)
                .map((c) => (
                  <li key={c.line}>
                    <span className="mono">{c.summary}</span>:{" "}
                    {OUTCOME[c.before.outcome] ?? c.before.outcome} before,{" "}
                    {OUTCOME[c.after.outcome] ?? c.after.outcome} now ({c.after.ruleId})
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy || !dirty}
            onClick={() => void runPreview()}
          >
            Preview what changes
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            Save and apply
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !dirty}
            onClick={() => {
              setDraft(clean(data.user))
              setPreview(undefined)
              setErrors(undefined)
            }}
          >
            Discard changes
          </button>
          <span className="text-[13px] text-mut">
            {dirty ? "You have changes that are not saved." : "Everything here is in force."}
          </span>
        </div>
      </div>
    </div>
  )
}

const lines = (t: string) =>
  t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)

/** A form for one rule of yours. The Host checks it again when you save. */
function RuleEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: { section: YourSection; rule: Rule }
  onSave: (section: YourSection, rule: Rule) => void
  onCancel: () => void
}) {
  const [section, setSection] = useState<YourSection>(initial.section)
  const [id, setId] = useState(initial.rule.id)
  const [tools, setTools] = useState((initial.rule.tools ?? []).join(", "))
  const [commands, setCommands] = useState((initial.rule.commands ?? []).join("\n"))
  const [paths, setPaths] = useState((initial.rule.pathGlobs ?? []).join("\n"))
  const [inside, setInside] = useState(initial.rule.pathInside === "workspaceRoots")
  const [risk, setRisk] = useState(initial.rule.risk ?? 60)
  const [message, setMessage] = useState(initial.rule.message ?? "")
  const [problem, setProblem] = useState<string>()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^my-[a-z0-9][a-z0-9-]*$/.test(id)) {
      setProblem(
        'The name must start with "my-" and use only lower-case letters, numbers and dashes.',
      )
      return
    }
    const rule: Rule = { id }
    const t = tools
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
    if (t.length) rule.tools = t
    if (lines(commands).length) {
      rule.commands = lines(commands)
      if (section === "allow") rule.everySegmentMustMatch = true
    }
    if (lines(paths).length) rule.pathGlobs = lines(paths)
    if (inside) rule.pathInside = "workspaceRoots"
    if (section === "escalate") rule.risk = Math.max(0, Math.min(100, Math.round(risk)))
    if (message.trim()) rule.message = message.trim()
    if (!rule.tools && !rule.commands && !rule.pathGlobs && !rule.pathInside) {
      setProblem(
        "Give at least one tool, command or file pattern, so the rule matches something specific.",
      )
      return
    }
    onSave(section, rule)
  }

  return (
    <form onSubmit={submit} className="panel grid gap-3 p-4" aria-label="Your rule">
      <h3 className="m-0 text-[16px]">Your rule</h3>
      <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
        <label className="grid gap-1">
          <span>Name</span>
          <input className="field mono" value={id} onChange={(e) => setId(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span>What it does</span>
          <select
            className="field"
            value={section}
            onChange={(e) => setSection(e.target.value as YourSection)}
          >
            <option value="allow">Goes through without asking</option>
            <option value="escalate">Asks you</option>
            <option value="deny">Blocks it</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1">
        <span>Commands, one per line (* matches anything)</span>
        <textarea
          className="field mono min-h-20"
          value={commands}
          onChange={(e) => setCommands(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
        <label className="grid gap-1">
          <span>Tools, separated by commas (for example Read, Edit)</span>
          <input className="field mono" value={tools} onChange={(e) => setTools(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span>File patterns, one per line</span>
          <textarea
            className="field mono min-h-10"
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} />
        Only inside your workspace folders
      </label>
      {section === "escalate" ? (
        <label className="grid w-40 gap-1">
          <span>Risk (0 to 100)</span>
          <input
            className="field"
            type="number"
            min={0}
            max={100}
            value={risk}
            onChange={(e) => setRisk(Number(e.target.value))}
          />
        </label>
      ) : null}
      <label className="grid gap-1">
        <span>Reason shown with it (optional)</span>
        <input className="field" value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      {problem ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button className="btn btn-primary">Keep this rule</button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="m-0 text-xs text-mut">
        The rule is added to your changes. Choose Save and apply to put it in force. The floor still
        blocks secrets and dangerous commands whatever your rules say.
      </p>
    </form>
  )
}
