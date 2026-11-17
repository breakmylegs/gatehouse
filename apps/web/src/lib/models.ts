import { useEffect, useState } from "react"
import { api } from "./api"

export interface ModelChoice {
  id: string
  label: string
}

/** The models every picker offers; "" is Claude Code's own default. */
export const BUILT_IN_MODELS: readonly ModelChoice[] = [
  { id: "", label: "Default model" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
]

/** T-016: what Settings, Sessions, Your own models adds, kept here once read so labels are known everywhere. */
let custom: ModelChoice[] = []
let loading: Promise<ModelChoice[]> | undefined
const subs = new Set<() => void>()

/** The built-in models, then yours (a custom one with a built-in id renames it). */
export function allModels(extra: readonly ModelChoice[] = custom): ModelChoice[] {
  const out = BUILT_IN_MODELS.map((m) => ({ ...m, ...(extra.find((c) => c.id === m.id && m.id) ?? {}) }))
  for (const c of extra) if (c.id && !out.some((m) => m.id === c.id)) out.push({ id: c.id, label: c.label })
  return out
}

/** A model's name as you know it, or its id. */
export const modelLabel = (id: string | undefined, fallback = "Default model"): string =>
  allModels().find((m) => m.id === (id ?? ""))?.label ?? id ?? fallback

/** Takes the list from Settings as saved (also when Settings saves a new one). */
export function setCustomModels(list: unknown): void {
  custom = Array.isArray(list)
    ? list
        .filter((m): m is ModelChoice => !!m && typeof (m as ModelChoice).id === "string" && typeof (m as ModelChoice).label === "string")
        .map((m) => ({ id: m.id, label: m.label }))
    : []
  subs.forEach((f) => f())
}

function load(): Promise<ModelChoice[]> {
  loading ??= api<{ saved: { customModels?: unknown } }>("GET", "/api/settings").then((r) => {
    if (r.ok) setCustomModels(r.data?.saved.customModels)
    return custom
  })
  return loading
}

/** Every model a picker offers, yours included once Settings has been read. */
export function useModels(): ModelChoice[] {
  const [, setTick] = useState(0)
  useEffect(() => {
    const again = () => setTick((n) => n + 1)
    subs.add(again)
    void load()
    return () => void subs.delete(again)
  }, [])
  return allModels()
}

/** "id = Display name", one to a line, as Settings shows and reads them. */
export const modelsText = (list: readonly ModelChoice[]) => list.map((m) => `${m.id} = ${m.label}`).join("\n")

export function parseModels(text: string): { models: ModelChoice[]; errors: string[] } {
  const models: ModelChoice[] = []
  const errors: string[] = []
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf("=")
    const id = (at < 0 ? line : line.slice(0, at)).trim()
    const label = (at < 0 ? line : line.slice(at + 1)).trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._:\-[\]/]{0,99}$/.test(id)) errors.push(`Line ${i + 1}: "${id}" is not a model id.`)
    else if (!label || label.length > 40) errors.push(`Line ${i + 1}: give it a name of 1 to 40 characters.`)
    else if (!models.some((m) => m.id === id)) models.push({ id, label })
  }
  if (models.length > 20) errors.push("At most 20 models of your own.")
  return { models: models.slice(0, 20), errors }
}
