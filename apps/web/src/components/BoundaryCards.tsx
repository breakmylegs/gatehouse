import { useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"

/** What one provider does with your words, as you recorded it (B17). Codehouse cannot find this out itself. */
export interface Boundary {
  keeps?: string
  training?: "no" | "yes" | "unknown"
  region?: string
  zdr?: "yes" | "no" | "unknown"
  checkedAt?: string
  source?: string
  /** D-085: the most sensitive content it may be handed, while the card is in date. */
  maxClassification?: "public" | "internal" | "confidential" | "restricted"
}
export type BoundaryProvider = "claude" | "local"

const NAMES: Record<BoundaryProvider, string> = {
  claude: "Claude (Anthropic, through your organisation's account)",
  local: "Models on this computer, or your organisation's gateway",
}

/** The card in one line: what it keeps, training, region, zero retention, and when it was checked. */
export function boundaryLine(b: Boundary | undefined): string {
  if (!b || Object.keys(b).length === 0) return "Not recorded yet."
  const said = (v: string | undefined) => (v === "yes" ? "yes" : v === "no" ? "no" : "not known")
  return [
    `Keeps: ${b.keeps?.trim() || "not known"}`,
    `trains on it: ${said(b.training)}`,
    `region: ${b.region?.trim() || "not known"}`,
    `zero data retention: ${said(b.zdr)}`,
    b.checkedAt ? `checked ${b.checkedAt}${b.source ? ` (${b.source})` : ""}` : "not checked",
  ].join(", ")
}

/**
 * B17: a card for each provider saying where your words go: how long it keeps them, whether it trains on them, where,
 * whether there is a zero-retention agreement, and when and where you checked. Saved to the settings file, after it is
 * recorded in the audit log.
 */
/** C-016: the cards, a card for one model, and how old a card's check may be before a send is refused. */
export type Boundaries = Partial<Record<BoundaryProvider, Boundary>> & {
  models?: Record<string, Boundary>
  maxAgeDays?: number
}

/** C-016: whether a card is stale: recorded, but undated or checked longer ago than allowed. */
export function stale(b: Boundary | undefined, maxAgeDays: number, now = new Date()): boolean {
  if (!b || Object.keys(b).length === 0) return false
  if (!b.checkedAt) return true
  const at = Date.parse(`${b.checkedAt}T00:00:00Z`)
  return !Number.isFinite(at) || Math.floor((now.getTime() - at) / 86_400_000) > maxAgeDays
}

export function BoundaryCards({
  boundaries,
  onSaved,
}: {
  boundaries: Boundaries | undefined
  onSaved: (view: unknown) => void
}) {
  const maxAge = boundaries?.maxAgeDays ?? 180
  const [age, setAge] = useState(String(maxAge))
  const [newModel, setNewModel] = useState("")
  const [adding, setAdding] = useState<string[]>([])
  const models = [...new Set([...Object.keys(boundaries?.models ?? {}), ...adding])]
  async function saveAge() {
    const r = await api("PUT", "/api/providers/boundary-age", { days: Number(age) })
    if (!r.ok) return void toast.error(r.error ?? "Not saved", { id: "settings" })
    onSaved(r.data)
    toast("Saved, and recorded in the audit log", { id: "settings" })
  }
  return (
    <div className="grid gap-2">
      <span className="font-semibold">Where your words go</span>
      <p className="m-0 text-xs text-mut">
        Record what each provider does with what you send, from its terms or your IT team, so you
        can choose which a project may use. Codehouse cannot check this itself. A model can have a
        card of its own, which says more than its provider's. Once a card is recorded, nothing is
        sent to its model when the card was checked longer ago than you allow below, or has no date.
      </p>
      {(["claude", "local"] as const).map((p) => (
        <Card key={p} provider={p} boundary={boundaries?.[p]} maxAge={maxAge} onSaved={onSaved} />
      ))}
      {models.map((m) => (
        <Card key={m} provider="claude" model={m} boundary={boundaries?.models?.[m]} maxAge={maxAge} onSaved={onSaved} />
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span>A card for one model (its id)</span>
          <input className="field mono" maxLength={120} placeholder="claude-opus-5-5" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn"
          disabled={!/^[\w.:/-]{1,120}$/.test(newModel.trim())}
          onClick={() => {
            setAdding((a) => [...a, newModel.trim()])
            setNewModel("")
          }}
        >
          Add a card
        </button>
        <label className="grid gap-1 text-sm">
          <span>Refuse a send when its card was checked more than this many days ago</span>
          <input className="field" type="number" min={1} max={3650} value={age} onChange={(e) => setAge(e.target.value)} />
        </label>
        <button type="button" className="btn" disabled={!(Number(age) >= 1 && Number(age) <= 3650) || Number(age) === maxAge} onClick={() => void saveAge()}>
          Save
        </button>
      </div>
    </div>
  )
}

function Card({
  provider,
  model,
  boundary,
  maxAge,
  onSaved,
}: {
  provider: BoundaryProvider
  /** C-016: a card for this one model rather than its provider. */
  model?: string
  boundary: Boundary | undefined
  maxAge: number
  onSaved: (view: unknown) => void
}) {
  const [b, setB] = useState<Boundary>(boundary ?? {})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Boundary, v: string) =>
    setB((x) => {
      const { [k]: _gone, ...rest } = x
      return v ? { ...rest, [k]: v } : rest
    })
  async function save() {
    setBusy(true)
    const r = await api("PUT", "/api/providers/boundary", { provider, boundary: b, ...(model ? { model } : {}) })
    setBusy(false)
    if (!r.ok) {
      toast.error(r.errors?.[0] ?? r.error ?? "Not saved", { id: "settings" })
      return
    }
    onSaved(r.data)
    toast("Saved, and recorded in the audit log", { id: "settings" })
  }
  return (
    <details className="panel p-3" aria-label={`Where your words go: ${model ?? NAMES[provider]}`}>
      <summary className="cursor-pointer">
        <strong className={model ? "mono" : ""}>{model ?? NAMES[provider]}</strong>
        <span className="block text-xs text-mut">{boundaryLine(boundary)}</span>
        {stale(boundary, maxAge) ? (
          <span className="block text-xs font-semibold text-sev">
            Stale: nothing is sent to {model ?? "this provider"} until you check it again and save a new date.
          </span>
        ) : null}
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-2 max-[700px]:grid-cols-1">
        <label className="grid gap-1 text-sm">
          <span>What it keeps, and for how long</span>
          <input
            className="field"
            maxLength={80}
            placeholder="30 days"
            value={b.keeps ?? ""}
            onChange={(e) => set("keeps", e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Trains its models on it</span>
          <select
            className="field"
            value={b.training ?? "unknown"}
            onChange={(e) => set("training", e.target.value)}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
            <option value="unknown">Not known</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Where it is processed</span>
          <input
            className="field"
            maxLength={80}
            placeholder="EU"
            value={b.region ?? ""}
            onChange={(e) => set("region", e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Zero data retention agreement</span>
          <select
            className="field"
            value={b.zdr ?? "unknown"}
            onChange={(e) => set("zdr", e.target.value)}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unknown">Not known</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Checked on</span>
          <input
            className="field"
            type="date"
            value={b.checkedAt ?? ""}
            onChange={(e) => set("checkedAt", e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>The most sensitive content it may be handed</span>
          <select
            className="field"
            value={b.maxClassification ?? "internal"}
            onChange={(e) => set("maxClassification", e.target.value)}
          >
            <option value="public">Public</option>
            <option value="internal">Internal</option>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Where you checked (a page, or who told you)</span>
          <input
            className="field"
            maxLength={200}
            value={b.source ?? ""}
            onChange={(e) => set("source", e.target.value)}
          />
        </label>
      </div>
      <button type="button" className="btn mt-3" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save"}
      </button>
    </details>
  )
}
