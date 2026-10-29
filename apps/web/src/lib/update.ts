import { toast } from "sonner"
import { useStore } from "../store"
import { api } from "./api"

/** What the Host says about updates (apps/host/src/update/service.ts). */
export interface UpdateStatus {
  current: string
  kind: "release" | "source"
  canInstall: boolean
  why?: string
  previous?: string
  settings: { checkEveryMinutes: number; downloadInBackground: boolean; skipped: string[] }
  where: string
  tokenSet: boolean
  checking: boolean
  lastCheck?: string
  nextCheck?: string
  checkError?: string
  latest?: { version: string; notes: string; publishedAt?: string }
  available: boolean
  phase: "idle" | "preparing" | "ready" | "applying" | "failed"
  progress?: { step: string; done: number; total: number; label: string }
  error?: string
  ready?: string
  lastResult?: {
    ok: boolean
    mode?: string
    from?: string
    to?: string
    reason?: string
    at?: string
  }
}

export const INTERVALS = [
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 240, label: "Every 4 hours" },
  { value: 1440, label: "Once a day" },
  { value: 0, label: "Never (check by hand)" },
] as const

/** Calls an update route and keeps the store's copy current. Says what went wrong, with the status. */
export async function updateCall(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<UpdateStatus | undefined> {
  const r = await api<UpdateStatus>(method, url, body)
  if (r.ok && r.data) {
    useStore.getState().setUpdate(r.data)
    return r.data
  }
  if (r.status !== 404) toast.error(r.error ?? `The update request failed (${r.status}).`)
  return undefined
}

/** The release notes as lines, without the list markers. */
export const noteLines = (notes: string): string[] =>
  notes
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)

export const when = (iso?: string): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
