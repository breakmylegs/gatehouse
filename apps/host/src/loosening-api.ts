import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { configPath, writeFileAtomic } from "@gatehouse/shared/node"
import { createHash } from "node:crypto"
import type { Policy } from "@gatehouse/policy"
import type { AdminContext } from "./api.js"
import { isLevel, LEVEL_NAMES } from "./autonomy.js"
import { COOLING_MS, looseningPhrase, type Loosening, type LooseningKind } from "./loosening.js"

const sha = (s: string) => createHash("sha256").update(s).digest("hex")

export type LooseningAnswer =
  | { status: 409; body: { error: string; loosening: { what: string; phrase: string; minutes: number } } }
  | { status: 202 | 503; body: Record<string, unknown> }

/**
 * D-024: asks for the typed phrase, then keeps the loosening to apply after the wait, recorded first and told to the
 * phone and push channels for information. Without the phrase nothing is kept; without a record nothing is kept.
 */
export async function deferLoosening(
  ctx: AdminContext,
  kind: LooseningKind,
  what: string,
  payload: Record<string, unknown>,
  key: string,
  confirm: unknown,
): Promise<LooseningAnswer> {
  const phrase = looseningPhrase(what)
  const minutes = COOLING_MS / 60_000
  if (!ctx.loosening) return { status: 503, body: { error: "Loosening cannot be kept here, so nothing changed." } }
  if (confirm !== phrase)
    return {
      status: 409,
      body: { error: `This loosens what Codehouse asks or refuses (${what}). Type "${phrase}" to go ahead; it then applies after ${minutes} minutes.`, loosening: { what, phrase, minutes } },
    }
  const recorded = await ctx.audit.record({
    session: "desktop",
    event: "loosening_requested",
    channel: "desktop",
    tool: "loosening",
    input: { kind, what },
    verdict: { outcome: "allow", ruleId: "loosening-requested", reason: `You confirmed on the desktop: ${what}. It applies in ${minutes} minutes unless you cancel it.`, risk: 0, decidedBy: "human-desktop", policyHash: ctx.store.current?.hash ?? "" },
    latencyMs: 0,
  })
  if (!recorded) return { status: 503, body: { error: "It could not be recorded, so nothing changed." } }
  const item = await ctx.loosening.add(kind, what, payload, key)
  ctx.tell?.("Loosening in 10 minutes", `${what}. Cancel it on the desktop if this was not you.`)
  return { status: 202, body: { pending: view(item) } }
}

const view = (i: Loosening) => ({ id: i.id, kind: i.kind, what: i.what, requestedAt: i.requestedAt, appliesAt: i.appliesAt })

/** The deny and ask rules (floor included) the old rules have that the new ones no longer have in the same place. */
export function rulesRemoved(was: Policy, next: Policy): string[] {
  const out: string[] = []
  for (const section of ["floor", "deny", "escalate"] as const) {
    const kept = new Set(next.rules[section].map((r) => r.id))
    for (const r of was.rules[section]) if (!kept.has(r.id)) out.push(r.id)
  }
  return out
}

/** Strictness about tests a change removes: every project, or the ones named. Empty when it removes none. */
export function testStrictnessRemoved(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as { strictAll?: boolean; strictProjects?: string[] }
  const a = (after ?? {}) as { strictAll?: boolean; strictProjects?: string[] }
  if (b.strictAll && !a.strictAll) return ["every project"]
  if (a.strictAll) return []
  const now = new Set(a.strictProjects ?? [])
  return (b.strictProjects ?? []).filter((p) => !now.has(p))
}

/** What is strict while a loosening waits: both, so the tightening half applies at once. */
export function strictUnion(before: unknown, after: unknown): Record<string, unknown> | undefined {
  const b = (before ?? {}) as { strictAll?: boolean; strictProjects?: string[] }
  const a = (after ?? {}) as { strictAll?: boolean; strictProjects?: string[] }
  const all = b.strictAll === true || a.strictAll === true
  const projects = [...new Set([...(b.strictProjects ?? []), ...(a.strictProjects ?? [])])]
  if (!all && !projects.length) return undefined
  return { ...b, ...a, ...(all ? { strictAll: true } : {}), ...(projects.length ? { strictProjects: projects } : {}) }
}

/** The list waiting, cancelling one, and applying each once its wait is over (checked every 30 seconds). */
export function registerLooseningRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const store = ctx.loosening
  if (!store) return
  const record = (event: string, item: Loosening, reason: string, by: "rules" | "human-desktop") =>
    ctx.audit.record({
      session: "desktop",
      event,
      channel: by === "rules" ? "host" : "desktop",
      tool: "loosening",
      input: { kind: item.kind, what: item.what },
      verdict: { outcome: "allow", ruleId: event.replace(/_/g, "-"), reason, risk: 0, decidedBy: by, policyHash: ctx.store.current?.hash ?? "" },
      latencyMs: 0,
    })

  /** Applies one: false (and the reason) when what it would change has moved since, so it is dropped instead. */
  const apply = async (item: Loosening): Promise<true | string> => {
    if (item.kind === "rules") {
      const file = ctx.loadOptions.rulesPath
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
      if (sha(current) !== item.payload.baseHash) return "the rules file changed since"
      await writeFileAtomic(file, String(item.payload.yaml))
      ctx.store.load()
      return true
    }
    if (item.kind === "test-integrity") {
      const file = configPath(ctx.env)
      const onDisk = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {}
      const next = { ...onDisk }
      if (item.payload.value === null || item.payload.value === undefined) delete next.testIntegrity
      else next.testIntegrity = item.payload.value
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, JSON.stringify(next, null, 2) + "\n")
      const running = ctx.config() as Record<string, unknown>
      if (next.testIntegrity === undefined) delete running.testIntegrity
      else running.testIntegrity = next.testIntegrity
      return true
    }
    const project = String(item.payload.project)
    const level = item.payload.level
    if (!ctx.autonomy || !isLevel(level)) return "the autonomy caps are not kept here"
    try {
      await ctx.autonomy.raise(project, level)
    } catch (e) {
      return (e as Error).message
    }
    return true
  }

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      for (const item of store.due()) {
        // Recorded before it applies; one that cannot be recorded waits for the next look.
        if (!(await record("loosening_applied", item, `The wait is over: ${item.what}.`, "rules"))) continue
        const r = await apply(item).catch((e: Error) => e.message)
        await store.remove(item.id)
        if (r !== true) {
          await record("loosening_dropped", item, `It was not applied: ${r}.`, "rules")
          continue
        }
        if (item.kind === "autonomy")
          await ctx.audit.record({
            session: "desktop",
            event: "autonomy_raised",
            channel: "desktop",
            tool: "autonomy",
            input: { project: item.payload.project, level: item.payload.level },
            verdict: { outcome: "allow", ruleId: "autonomy-raised", reason: `${String(item.payload.project)}'s cap was raised to ${LEVEL_NAMES[item.payload.level as keyof typeof LEVEL_NAMES] ?? String(item.payload.level)}, as you confirmed ${COOLING_MS / 60_000} minutes ago.`, risk: 0, decidedBy: "human-desktop", policyHash: ctx.store.current?.hash ?? "" },
            latencyMs: 0,
          })
        ctx.tell?.("Loosening applied", `${item.what}.`)
      }
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick().catch(() => undefined), 30_000)
  timer.unref?.()
  app.addHook("onClose", async () => clearInterval(timer))

  app.get("/api/loosening", async () => {
    await tick().catch(() => undefined)
    return { pending: store.list().map(view), minutes: COOLING_MS / 60_000 }
  })
  app.post("/api/loosening/:id/cancel", async (req, reply) => {
    const id = (req.params as { id: string }).id
    const item = store.list().find((i) => i.id === id)
    if (!item) return reply.code(404).send({ error: "Nothing like that is waiting." })
    if (!(await record("loosening_cancelled", item, `You cancelled it on the desktop: ${item.what}.`, "human-desktop")))
      return reply.code(503).send({ error: "It could not be recorded, so it still waits." })
    await store.remove(id)
    return { pending: store.list().map(view) }
  })
}
