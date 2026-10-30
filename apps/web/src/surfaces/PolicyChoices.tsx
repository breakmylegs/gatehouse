import clsx from "clsx"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import {
  applyChoices,
  CHOICES,
  levelPicks,
  LEVELS,
  readChoices,
  readLevel,
  type Choice,
  type Level,
  type UserRulesShape,
} from "../lib/choices"

interface LibraryData {
  path: string | null
  errors: string[]
  packs: Array<{ id: string; title: string; rules: Array<{ id: string }> }>
  user: UserRulesShape
}
interface PolicyBits {
  remember: Array<{ id: string; tools?: string[]; commands?: string[]; paths?: string[] }>
  rules?: { workspaceRoots: string[] }
}
interface Suggestion {
  candidate: { tool: string; command?: string; path?: string }
  approvals: number
}
interface Verdict {
  outcome: string
  ruleId: string
  reason: string
}

/** The floor and the deny rules, in words: what no level, switch or rule of yours can allow. */
const FIXED: Array<{ label: string; state: "Always blocked" }> = [
  { label: "Change files outside your project folders", state: "Always blocked" },
  { label: "Secrets: .env files, keys and passwords", state: "Always blocked" },
  {
    label: "Destructive commands: delete everything, force push, wipe your changes, format a disk",
    state: "Always blocked",
  },
  { label: "Change Windows or Program Files", state: "Always blocked" },
  { label: "Hidden or encoded commands", state: "Always blocked" },
]

/** Built-in rules in words, for the Try it answer. Pack rules are named by the choice that owns their pack. */
const RULE_WORDS: Record<string, string> = {
  "secrets-files": "secrets files are always blocked",
  "obfuscated-shell": "hidden or encoded commands are always blocked",
  "critical-paths": "Windows and program folders are always blocked",
  "outside-workspace-write": "files outside your project folders are blocked",
  "destructive-shell": "destructive commands are always blocked",
  "package-install": "installing packages asks you",
  network: "using the web asks you",
  "git-remote": "sending code to other servers asks you",
  "mcp-external": "outside tools (connectors) ask you",
  "unc-path": "network paths ask you",
  "read-workspace": "reading your project folders is allowed",
  "edit-workspace-source": "changing code, tests and docs is allowed",
  "safe-shell": "safe commands such as git status are allowed",
  "companion-tools": "JCVC's own tools are allowed",
  "no-rule": "nothing you allowed covers it, so it asks you",
  "my-jcvc-no-push": "you blocked sending code to other servers",
}

const OUTCOME_WORDS: Record<string, string> = {
  allow: "Claude would do this without asking.",
  escalate: "Claude would ask you first.",
  deny: "Blocked: Claude cannot do this.",
}

/**
 * The Policy page for everyone: how much Claude may do without asking, as a level and a handful of switches in
 * words. Each change saves at once, is recorded in the audit log by the Host, and can be undone from the toast.
 */
export function PolicyChoices({ onAdvanced }: { onAdvanced: () => void }) {
  const [lib, setLib] = useState<LibraryData>()
  const [bits, setBits] = useState<PolicyBits>()
  const [sug, setSug] = useState<Suggestion[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [l, p, s] = await Promise.all([
      api<LibraryData>("GET", "/api/library"),
      api<PolicyBits>("GET", "/api/policy"),
      api<Suggestion[]>("GET", "/api/suggestions"),
    ])
    if (l.ok && l.data) {
      setLib(l.data)
      setError(undefined)
    } else setError(l.error ?? "Your choices could not be read")
    if (p.ok && p.data) setBits(p.data)
    if (s.ok && s.data) setSug(s.data)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function save(next: UserRulesShape, said: string, before: UserRulesShape) {
    setBusy(true)
    const r = await api("PUT", "/api/library", next)
    setBusy(false)
    if (!r.ok) {
      toast.error(`Not saved: ${r.errors?.[0] ?? r.error ?? "the Host refused it"}`, {
        id: "policy",
      })
      return
    }
    toast(said, {
      id: "policy",
      action: {
        label: "Undo",
        onClick: () => void save(before, "Undone: your previous choices are back.", next),
      },
    })
    await load()
  }

  if (error)
    return (
      <p role="alert" className="font-semibold text-sev">
        {error}
      </p>
    )
  if (!lib) return <p className="text-mut">Loading…</p>
  if (!lib.path)
    return (
      <p role="alert" className="m-0">
        Your choices cannot be saved on this Host (it has no rules file of yours). The Advanced view
        shows the rules in force.
      </p>
    )

  const user = lib.user
  const picks = readChoices(user)
  const level = readLevel(picks)
  const have = new Set(lib.packs.map((p) => p.id))
  const usable = (c: Choice, optionId: string) =>
    (c.options.find((o) => o.id === optionId)?.packs ?? []).every((p) => have.has(p))

  const pickLevel = (l: Level) => {
    const next = applyChoices(user, levelPicks(l))
    const name = LEVELS.find((x) => x.id === l)?.label ?? l
    void save(next, `Saved: ${name}.`, user)
  }
  const pick = (c: Choice, optionId: string) => {
    const option = c.options.find((o) => o.id === optionId)
    if (!option || picks[c.id] === optionId) return
    void save(applyChoices(user, { [c.id]: optionId }), `Saved: ${option.saved}`, user)
  }

  const groups = [...new Set(CHOICES.map((c) => c.group))]

  return (
    <div className="grid max-w-[920px] gap-8">
      {lib.errors.length ? (
        <ul role="alert" className="m-0 text-sev">
          {lib.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="level-h" className="grid gap-3">
        <div>
          <h2 id="level-h" className="m-0 text-[19px]">
            How much Claude does without asking
          </h2>
          <p className="m-0 text-mut">
            Anything not allowed comes to you to decide, on this computer and your phone. Each
            change saves at once and can be undone.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-labelledby="level-h"
          className="grid grid-cols-3 gap-3 max-[900px]:grid-cols-1"
        >
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={level === l.id}
              disabled={busy}
              className="level-card"
              onClick={() => level !== l.id && pickLevel(l.id)}
            >
              <span className="sign text-[17px] font-semibold">
                {l.label}
                {l.id === "balanced" ? (
                  <span className="ml-2 text-[12.5px] font-normal text-mut">for building apps</span>
                ) : null}
              </span>
              <span className="text-[13.5px]">{l.summary}</span>
            </button>
          ))}
        </div>
        {level === "custom" ? (
          <p className="m-0 text-[13.5px]">
            Your choices below are your own mix. Pick a level to set them all at once.
          </p>
        ) : null}
        {level !== "careful" ? (
          <p className="m-0 text-[13.5px] text-mut">
            Building and running your app runs your project&apos;s own scripts, which can do
            anything your Windows account can. Use these levels for projects you trust.
          </p>
        ) : null}
      </section>

      {groups.map((g) => (
        <section key={g} aria-labelledby={`g-${g}`} className="grid gap-1">
          <h2 id={`g-${g}`} className="m-0 mb-1 text-[17px]">
            {g}
          </h2>
          <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
            {CHOICES.filter((c) => c.group === g).map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 max-[800px]:grid-cols-1"
              >
                <span className="grid gap-0.5">
                  <span id={`c-${c.id}`} className="font-semibold">
                    {c.label}
                  </span>
                  <span className="text-[13.5px] text-mut">{c.help}</span>
                  {picks[c.id] === "custom" ? (
                    <span className="text-[13.5px]">
                      Set your own way in Advanced. Choosing here replaces that.
                    </span>
                  ) : null}
                </span>
                <span role="radiogroup" aria-labelledby={`c-${c.id}`} className="seg">
                  {c.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={picks[c.id] === o.id}
                      disabled={busy || !usable(c, o.id)}
                      onClick={() => pick(c, o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby="fixed-h" className="grid gap-1">
        <h2 id="fixed-h" className="m-0 text-[17px]">
          Always blocked, whatever you choose
        </h2>
        <p className="m-0 mb-1 text-[13.5px] text-mut">
          JCVC sets these. No level, switch or rule of yours can change them.
        </p>
        <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
          {FIXED.map((f) => (
            <li
              key={f.label}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2.5"
            >
              <span>{f.label}</span>
              <span className="sign text-[13px] font-semibold text-sev">{f.state}</span>
            </li>
          ))}
        </ul>
      </section>

      <Learned sug={sug} remember={bits?.remember ?? []} onChanged={load} />

      <TryIt roots={bits?.rules?.workspaceRoots ?? []} lib={lib} />

      <section aria-labelledby="adv-h" className="grid gap-2">
        <h2 id="adv-h" className="m-0 text-[17px]">
          Everything else
        </h2>
        <p className="m-0 text-mut">
          The Advanced view shows every rule, the packs behind these choices, rules of your own, the
          rules file and the figures.
        </p>
        <div>
          <button type="button" className="btn" onClick={onAdvanced}>
            Open Advanced
          </button>
        </div>
      </section>
    </div>
  )
}

/** Approvals you keep giving, offered as rules, and the answers you already made permanent. */
function Learned({
  sug,
  remember,
  onChanged,
}: {
  sug: Suggestion[]
  remember: PolicyBits["remember"]
  onChanged: () => Promise<void>
}) {
  async function accept(s: Suggestion) {
    const r = await api("POST", "/api/suggestions/accept", { candidate: s.candidate })
    if (!r.ok) return toast.error(r.error ?? "That could not be added", { id: "policy" })
    toast(`Saved: Claude now does ${s.candidate.command ?? s.candidate.path} without asking.`, {
      id: "policy",
    })
    await onChanged()
  }
  async function remove(id: string, what: string) {
    const r = await api("POST", "/api/policy/remember/remove", { id })
    if (!r.ok) return toast.error(r.error ?? "That could not be removed", { id: "policy" })
    toast(`Removed: Claude asks you about ${what} again.`, { id: "policy" })
    await onChanged()
  }
  const what = (r: PolicyBits["remember"][number]) =>
    r.commands?.[0] ?? r.paths?.[0] ?? (r.tools ?? []).join(", ")
  return (
    <section aria-labelledby="learn-h" className="grid gap-3">
      <div>
        <h2 id="learn-h" className="m-0 text-[17px]">
          Learned from you
        </h2>
        <p className="m-0 text-mut">
          Things you allowed at least three times and never refused. Each allows exactly that, and
          nothing like it.
        </p>
      </div>
      {sug.length === 0 ? (
        <p className="m-0 text-[13.5px]">
          Nothing yet. Suggestions appear as you approve requests.
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
          {sug.slice(0, 8).map((s) => (
            <li
              key={`${s.candidate.tool}:${s.candidate.command ?? s.candidate.path}`}
              className="flex flex-wrap items-center gap-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="mono [overflow-wrap:anywhere]">
                  {s.candidate.command ?? s.candidate.path}
                </span>
                <span className="block text-[13px] text-mut">
                  You allowed this {s.approvals} times.
                </span>
              </span>
              <button type="button" className="btn" onClick={() => void accept(s)}>
                Allow from now on
              </button>
            </li>
          ))}
        </ul>
      )}
      {remember.length ? (
        <>
          <h3 className="m-0 text-[15px]">You said yes for good to</h3>
          <ul className="m-0 list-none divide-y divide-line border-y border-line p-0">
            {remember.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="mono min-w-0 flex-1 [overflow-wrap:anywhere]">{what(r)}</span>
                <button type="button" className="btn" onClick={() => void remove(r.id, what(r))}>
                  Ask me again
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

const KINDS = [
  { id: "command", label: "run a command", tool: "Bash", key: "command", example: "npm run dev" },
  {
    id: "write",
    label: "create or change a file",
    tool: "Write",
    key: "file_path",
    example: "C:\\dev\\my-app\\index.html",
  },
  {
    id: "read",
    label: "read a file",
    tool: "Read",
    key: "file_path",
    example: "C:\\dev\\my-app\\.env",
  },
  {
    id: "web",
    label: "open a web page",
    tool: "WebFetch",
    key: "url",
    example: "https://react.dev/learn",
  },
] as const

/** The project folder a path sits in: the first folder under one of your roots. */
function projectOf(file: string, roots: string[]): string | undefined {
  const f = file.replaceAll("/", "\\")
  for (const r of roots) {
    const root = r.replaceAll("/", "\\").replace(/\\+$/, "")
    if (f.toLowerCase().startsWith(`${root.toLowerCase()}\\`)) {
      const first = f.slice(root.length + 1).split("\\")[0]
      return first ? `${root}\\${first}` : root
    }
  }
  return undefined
}

/** "What would happen if Claude wanted to ...": the real policy answers, in words. */
function TryIt({ roots, lib }: { roots: string[]; lib: LibraryData }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("command")
  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0]
  const [text, setText] = useState<string>(k.example)
  const [answer, setAnswer] = useState<{ outcome: string; why: string; detail: string }>()
  const [busy, setBusy] = useState(false)

  // A pack's rules are named by the choice that switches the pack on.
  const owner = new Map<string, string>()
  for (const c of CHOICES)
    for (const o of c.options)
      for (const p of o.packs ?? [])
        for (const r of lib.packs.find((x) => x.id === p)?.rules ?? [])
          owner.set(r.id, `your choice "${c.label}: ${o.label}"`)

  async function check(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    const value = text.trim()
    const input: Record<string, unknown> =
      k.tool === "Write"
        ? { file_path: value, content: "" }
        : k.tool === "WebFetch"
          ? { url: value, prompt: "" }
          : { [k.key]: value }
    const cwd =
      (k.key === "file_path" ? projectOf(value, roots) : undefined) ??
      roots[0]?.replaceAll("/", "\\") ??
      "C:\\dev"
    const r = await api<Verdict>("POST", "/api/policy/test", { toolName: k.tool, input, cwd })
    setBusy(false)
    if (!r.ok || !r.data) {
      setAnswer({ outcome: "error", why: r.error ?? "The check did not run.", detail: "" })
      return
    }
    const v = r.data
    setAnswer({
      outcome: v.outcome,
      why: owner.get(v.ruleId) ?? RULE_WORDS[v.ruleId] ?? `the rule ${v.ruleId}`,
      detail: v.reason,
    })
  }

  return (
    <section aria-labelledby="try-h" className="grid gap-3">
      <h2 id="try-h" className="m-0 text-[17px]">
        Try it
      </h2>
      <form onSubmit={check} className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span>What would happen if Claude wanted to</span>
          <select
            className="field"
            value={kind}
            aria-label="What Claude wants to do"
            onChange={(e) => {
              const next = KINDS.find((x) => x.id === e.target.value) ?? KINDS[0]
              if (text === k.example) setText(next.example)
              setKind(next.id)
              setAnswer(undefined)
            }}
          >
            {KINDS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="field mono min-w-[280px] flex-1"
            aria-label={
              k.key === "command" ? "The command" : k.key === "url" ? "The address" : "The file"
            }
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setAnswer(undefined)
            }}
            spellCheck={false}
          />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            Check
          </button>
        </div>
      </form>
      {answer ? (
        <div role="status" className="panel grid gap-1 p-3">
          <span
            className={clsx(
              "font-semibold",
              answer.outcome === "deny" || answer.outcome === "error" ? "text-sev" : "",
            )}
          >
            {OUTCOME_WORDS[answer.outcome] ?? answer.why}
          </span>
          {answer.outcome !== "error" ? (
            <span className="text-[13.5px]">
              Because {answer.why}. <span className="text-mut">{answer.detail}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
