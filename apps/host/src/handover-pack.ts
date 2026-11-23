/**
 * E-077, personal handover packs (Expansion E6). Before you hand over to someone (a holiday, a new role), one pack
 * across all your projects: the open sessions, the decisions waiting for a person, the grants that expire within a
 * week, the routines, and a summary written from them, with what you add. It is redacted first (your list and the
 * secret patterns), then signed with this computer's Ed25519 key (D-080's), so whoever receives it can check nothing
 * was changed: a pack changed after signing, in one byte, is refused. Signed session bundles (C-054) were not built,
 * so the pack signs itself the same way D-080's knowledge packs do.
 */
import crypto from "node:crypto"

export interface HandoverPack {
  v: 1
  kind: "codehouse-handover"
  createdAt: string
  by: string
  summary: string
  sessions: Array<{ id: string; project: string; title: string; state: string; mode: string }>
  pending: Array<{ id: string; project: string; tool: string; risk: number; reason: string; waitingSince: string }>
  grants: Array<{ id: string; reason: string; expiresAt: string; inDays: number }>
  routines: Array<{ id: string; name: string; project: string; when: string; enabled: boolean }>
}

export interface SignedHandover {
  pack: string
  signature: string
  publicKey: string
}

export interface HandoverInput {
  by: string
  note: string
  sessions: HandoverPack["sessions"]
  pending: HandoverPack["pending"]
  /** Remembered grants with the time they expire (ms), from the policy. */
  grants: Array<{ id: string; reason: string; notAfter?: number }>
  routines: HandoverPack["routines"]
  redact: (s: string) => string
  now?: Date
}

const WEEK = 7 * 86_400_000

export function makeHandover(i: HandoverInput): HandoverPack {
  const now = i.now ?? new Date()
  const grants = i.grants
    .filter((g) => typeof g.notAfter === "number" && g.notAfter > now.getTime() && g.notAfter - now.getTime() <= WEEK)
    .map((g) => ({ id: g.id, reason: i.redact(g.reason), expiresAt: new Date(g.notAfter!).toISOString(), inDays: Math.ceil((g.notAfter! - now.getTime()) / 86_400_000) }))
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
  const sessions = i.sessions.map((s) => ({ ...s, title: i.redact(s.title) }))
  const pending = i.pending.map((p) => ({ ...p, reason: i.redact(p.reason) }))
  const projects = [...new Set([...sessions.map((s) => s.project), ...pending.map((p) => p.project)])]
  const summary = [
    `${sessions.length} open session(s)${projects.length ? ` across ${projects.join(", ")}` : ""}.`,
    pending.length ? `${pending.length} decision(s) waiting for a person, the riskiest at ${Math.max(...pending.map((p) => p.risk))}.` : "No decision is waiting.",
    grants.length ? `${grants.length} grant(s) expire within a week, the first ${grants[0]!.expiresAt.slice(0, 10)}.` : "No grant expires within a week.",
    `${i.routines.filter((r) => r.enabled).length} routine(s) on, ${i.routines.filter((r) => !r.enabled).length} off.`,
    ...(i.note.trim() ? ["", i.redact(i.note.trim())] : []),
  ].join("\n")
  return { v: 1, kind: "codehouse-handover", createdAt: now.toISOString(), by: i.redact(i.by), summary, sessions, pending, grants, routines: i.routines.map((r) => ({ ...r, name: i.redact(r.name) })) }
}

export async function signHandover(pack: HandoverPack, sign: (b: Buffer) => Promise<{ signature: string; publicKey: string }>): Promise<SignedHandover> {
  const bytes = Buffer.from(JSON.stringify(pack), "utf8")
  return { pack: bytes.toString("base64"), ...(await sign(bytes)) }
}

/**
 * Checks a signed pack: the signature against the key it names, and that key against the keys you trust when you
 * give them. Refused when anything was changed after signing.
 */
export function openHandover(s: unknown, trusted?: readonly string[]): { ok: true; pack: HandoverPack; trustedKey: boolean } | { ok: false; why: string } {
  const x = s as Partial<SignedHandover> | undefined
  if (!x || typeof x.pack !== "string" || typeof x.signature !== "string" || typeof x.publicKey !== "string") return { ok: false, why: "It is not a signed Codehouse handover pack." }
  let key: crypto.KeyObject
  try {
    key = crypto.createPublicKey(x.publicKey)
  } catch {
    return { ok: false, why: "Its key cannot be read." }
  }
  const bytes = Buffer.from(x.pack, "base64")
  if (key.asymmetricKeyType !== "ed25519" || !crypto.verify(null, bytes, key, Buffer.from(x.signature, "base64"))) return { ok: false, why: "It was changed after it was signed, or the signature is not its own." }
  let pack: HandoverPack
  try {
    pack = JSON.parse(bytes.toString("utf8")) as HandoverPack
  } catch {
    return { ok: false, why: "Its contents cannot be read." }
  }
  if (pack.kind !== "codehouse-handover" || pack.v !== 1) return { ok: false, why: "It is not a Codehouse handover pack." }
  const trustedKey = !!trusted?.some((k) => k.trim() === x.publicKey!.trim())
  if (trusted && !trustedKey) return { ok: false, why: "It is signed by a key you do not trust." }
  return { ok: true, pack, trustedKey }
}

export function handoverMarkdown(p: HandoverPack): string {
  return [
    `# Handover from ${p.by}, ${p.createdAt.slice(0, 10)}`,
    "",
    p.summary,
    "",
    "## Open sessions",
    "",
    ...(p.sessions.length ? p.sessions.map((s) => `- ${s.project}: ${s.title} (${s.state}, ${s.mode})`) : ["- None."]),
    "",
    "## Waiting for a person",
    "",
    ...(p.pending.length ? p.pending.map((x) => `- ${x.project}, ${x.tool}, risk ${x.risk}: ${x.reason}`) : ["- None."]),
    "",
    "## Grants expiring within a week",
    "",
    ...(p.grants.length ? p.grants.map((g) => `- ${g.id}, ${g.expiresAt.slice(0, 10)} (in ${g.inDays} day(s)): ${g.reason}`) : ["- None."]),
    "",
    "## Routines",
    "",
    ...(p.routines.length ? p.routines.map((r) => `- ${r.name} (${r.project}), ${r.when}${r.enabled ? "" : ", off"}`) : ["- None."]),
    "",
  ].join("\n")
}
