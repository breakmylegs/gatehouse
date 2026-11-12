/**
 * C-016, a verified data-boundary card per model (Frontier build, Wave 2 prerequisite). Where your words go (B17) is
 * recorded per provider, and now per model too; each card is dated. A message to a session or chat whose model's card
 * is stale (checked longer ago than Settings allows, or never dated) is refused until the card is checked again, and
 * the refusal is recorded. A provider or model with no card at all is not refused: older versions kept none, and
 * refusing them would stop every session the day this arrives (the owner's rule that an update never breaks).
 */

import type { HostAudit } from "./hostaudit.js"

export const BOUNDARY_MAX_AGE_DAYS = 180

export interface BoundaryCard {
  keeps?: string
  training?: string
  region?: string
  zdr?: string
  checkedAt?: string
  source?: string
  /** D-085: the most sensitive content it may be handed. */
  maxClassification?: string
}

export interface Boundaries {
  claude?: BoundaryCard
  local?: BoundaryCard
  models?: Record<string, BoundaryCard>
  maxAgeDays?: number
}

export class BoundaryStaleError extends Error {}

/** The card a send to this model goes by: the model's own, or else its provider's. */
export function cardFor(b: Boundaries | undefined, local: boolean, model: string | undefined): { card: BoundaryCard; of: string } | undefined {
  if (!b) return undefined
  const own = model ? b.models?.[model] : undefined
  if (own && Object.keys(own).length) return { card: own, of: model! }
  const provider = local ? b.local : b.claude
  return provider && Object.keys(provider).length ? { card: provider, of: local ? "models on this computer" : "Claude" } : undefined
}

/** Why the card is stale, or undefined when it is in date. */
export function staleness(card: BoundaryCard, maxAgeDays: number, now: Date): string | undefined {
  if (!card.checkedAt) return "it has no date it was checked"
  const at = Date.parse(`${card.checkedAt}T00:00:00Z`)
  if (!Number.isFinite(at)) return "its date cannot be read"
  const days = Math.floor((now.getTime() - at) / 86_400_000)
  return days > maxAgeDays ? `it was last checked on ${card.checkedAt}, ${days} days ago, and Settings allows ${maxAgeDays}` : undefined
}

/**
 * The check before a message goes to a session: refused when its model's card is stale, and the refusal recorded
 * (the model, never the message). Throws BoundaryStaleError with the reason.
 */
export async function refuseStaleSend(
  s: { id: string; cwd: string; info(): { model?: string; local?: boolean } },
  b: Boundaries | undefined,
  audit: Pick<HostAudit, "record">,
  now = new Date(),
): Promise<void> {
  const info = s.info()
  try {
    checkBoundary(b, info.local === true, info.model, now)
  } catch (e) {
    if (!(e instanceof BoundaryStaleError)) throw e
    await audit
      .record({
        session: s.id,
        event: "boundary_stale_refused",
        channel: "desktop",
        tool: "prompt",
        cwd: s.cwd,
        input: { model: info.model ?? "", local: info.local === true },
        verdict: { outcome: "deny", ruleId: "boundary-stale", reason: e.message, risk: 0, decidedBy: "rules", policyHash: "" },
        latencyMs: 0,
      })
      .catch(() => false)
    throw e
  }
}

/** D-085: how sensitive content is, least first. */
export const LEVELS = ["public", "internal", "confidential", "restricted"] as const
export type Classification = (typeof LEVELS)[number]

/** A project's classification: its own, or the default from Settings, or internal. */
export function classificationOf(
  c: { default?: Classification; projects?: Record<string, Classification> } | undefined,
  project: string | undefined,
): Classification {
  const own = project ? Object.entries(c?.projects ?? {}).find(([k]) => k.toLowerCase() === project.toLowerCase())?.[1] : undefined
  return own ?? c?.default ?? "internal"
}

/**
 * D-085: why content of this classification may not be handed to this model, or undefined when it may. A model whose
 * card is in date may receive what its card allows (internal unless it says); one with no card, or a stale one, may
 * receive internal content at most, so confidential and restricted content goes only where a person has checked.
 */
export function handoffRefusal(
  b: Boundaries | undefined,
  local: boolean,
  model: string | undefined,
  classification: Classification,
  now = new Date(),
): string | undefined {
  const found = cardFor(b, local, model)
  const stale = found ? staleness(found.card, b?.maxAgeDays ?? BOUNDARY_MAX_AGE_DAYS, now) : "it has no card"
  const allowed = (!stale && (found?.card as { maxClassification?: Classification } | undefined)?.maxClassification) || "internal"
  if (LEVELS.indexOf(classification) <= LEVELS.indexOf(allowed)) return undefined
  return stale
    ? `This project's content is ${classification}, and the card saying where your words go for ${model ?? "that model"} is not in date (${stale}), so only internal content may go there. Check its terms and update its card in Settings first.`
    : `This project's content is ${classification}, and the card for ${found?.of ?? model} allows ${allowed} at most.`
}

/** D-085: refuses a hand-off the target model's card does not allow, recorded as handoff_denied. The reason, or none. */
export async function refuseHandoff(
  o: { session: string; from: string; to: string; local: boolean; classification: Classification },
  b: Boundaries | undefined,
  audit: Pick<HostAudit, "record">,
  now = new Date(),
): Promise<string | undefined> {
  const refused = handoffRefusal(b, o.local, o.to, o.classification, now)
  if (!refused) return undefined
  await audit
    .record({
      session: o.session,
      event: "handoff_denied",
      channel: "desktop",
      tool: "handoff",
      input: { from: o.from, to: o.to, classification: o.classification },
      verdict: { outcome: "deny", ruleId: "handoff-boundary", reason: refused, risk: 0, decidedBy: "rules", policyHash: "" },
      latencyMs: 0,
    })
    .catch(() => false)
  return refused
}

/** Refuses a send to this model when its card is stale. */
export function checkBoundary(b: Boundaries | undefined, local: boolean, model: string | undefined, now = new Date()): void {
  const found = cardFor(b, local, model)
  if (!found) return
  const why = staleness(found.card, b?.maxAgeDays ?? BOUNDARY_MAX_AGE_DAYS, now)
  if (why)
    throw new BoundaryStaleError(
      `Not sent: the card saying where your words go for ${found.of} is stale, because ${why}. Check the provider's terms, then update the card in Settings, Sessions, Where your words go.`,
    )
}
