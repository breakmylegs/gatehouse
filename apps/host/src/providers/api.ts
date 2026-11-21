import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { GatehouseConfig, writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "../hostaudit.js"
import { machineProfile } from "./profile.js"
import type { ItModels } from "./it-models.js"
import {
  addressProblem,
  checkRuntime,
  modelLicence,
  runtimeLabel,
  RUNTIME_FIELDS,
  type LocalRuntimeConfig,
} from "./local-runtime.js"
import { judgeRuntime } from "../claim-judge.js"
import { findFoundry, type FoundFoundry } from "./foundry-local.js"
import { managedRefusal, providerAllowed, type ManagedSettings } from "@gatehouse/policy"

type Providers = NonNullable<GatehouseConfig["providers"]>

/**
 * Settings for other providers (ADR 0009, 0011): whether they are on, and a model runtime on this computer with the
 * models you allow. Saved by adding to the settings file only (what else is there is kept), after the change is
 * recorded; nothing is saved that could not be recorded.
 */
export function registerProviderRoutes(
  app: FastifyInstance,
  ctx: {
    audit: HostAudit
    config: () => GatehouseConfig
    configFile?: string
    fetchFn?: typeof fetch
    /** B19: IT's signed list of the models this computer may run. */
    itModels?: () => ItModels
    /** T-067: the organisation's managed settings, for the providers it allows. */
    managed?: () => ManagedSettings | undefined
    /** C-067: finds Foundry Local on this computer (a test passes its own). */
    findFoundry?: () => Promise<FoundFoundry | undefined>
  },
): void {
  const view = async () => {
    const p = ctx.config().providers
    const enabled = p?.multi?.enabled === true
    const local = p?.local as LocalRuntimeConfig | undefined
    return {
      enabled,
      ...(p?.boundaries ? { boundaries: p.boundaries } : {}),
      ...(p?.claimJudge ? { claimJudge: p.claimJudge.model } : {}),
      ...(local ? { local, label: runtimeLabel(local) } : {}),
      ...(enabled && local
        ? { check: await checkRuntime(local, ctx.fetchFn, ctx.itModels?.()) }
        : {}),
    }
  }

  app.get("/api/providers", async () => await view())

  // B19: what this computer can run, and a model's licence before you use it. Read only; nothing leaves the computer.
  app.get("/api/providers/profile", async () => await machineProfile())
  app.get("/api/providers/licence", async (req, reply) => {
    const model = (req.query as { model?: unknown }).model
    const local = ctx.config().providers?.local as LocalRuntimeConfig | undefined
    if (typeof model !== "string" || !local)
      return reply.code(404).send({ error: "There is no such model on this computer." })
    const licence = await modelLicence(local, model, ctx.fetchFn)
    return { licence: licence ?? null }
  })

  // C-067: where Foundry Local listens now (its port changes each time it starts) and the models it has. Read only.
  app.get("/api/providers/foundry", async () => {
    const found = await (ctx.findFoundry ?? (() => findFoundry(process.env, undefined, ctx.fetchFn)))()
    return found ? { found: true, url: found.url, models: found.models } : { found: false }
  })

  // B17: what a provider does with your words, as you recorded it. Recorded first, then saved by adding.
  app.put("/api/providers/boundary", async (req, reply) => {
    const file = ctx.configFile
    if (!file) return reply.code(404).send({ error: "Settings cannot be saved here." })
    const b = (req.body ?? {}) as { provider?: unknown; boundary?: unknown; model?: unknown }
    if (b.provider !== "claude" && b.provider !== "local")
      return reply.code(422).send({ error: "Say which provider: claude or local." })
    // C-016: a card for one model, kept under models by its id.
    const model = typeof b.model === "string" && b.model.trim() ? b.model.trim() : undefined
    if (model !== undefined && !/^[\w.:/-]{1,120}$/.test(model))
      return reply.code(422).send({ error: "That is not a model id." })
    const candidate = GatehouseConfig.shape.providers.safeParse({
      boundaries: model ? { models: { [model]: b.boundary ?? {} } } : { [b.provider]: b.boundary ?? {} },
    })
    if (!candidate.success)
      return reply.code(422).send({
        error: "Those details are not valid.",
        errors: candidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      })
    const boundary = (model ? candidate.data?.boundaries?.models?.[model] : candidate.data?.boundaries?.[b.provider]) ?? {}
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "provider_boundary_changed",
      channel: "desktop",
      tool: "settings",
      cwd: "",
      input: { provider: b.provider, ...(model ? { model } : {}), ...boundary },
      verdict: {
        outcome: "allow",
        ruleId: "provider-boundary-changed",
        reason: "What a provider does with your words was recorded from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    if (!recorded)
      return reply.code(503).send({ error: "It could not be recorded, so it was not saved." })
    let onDisk: Record<string, unknown> = {}
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    } catch {
      // no settings file yet
    }
    const providers = (onDisk.providers as Record<string, unknown> | undefined) ?? {}
    const boundaries = (providers.boundaries as Record<string, unknown> | undefined) ?? {}
    const models = (boundaries.models as Record<string, unknown> | undefined) ?? {}
    const merged = {
      ...onDisk,
      providers: {
        ...providers,
        boundaries: model ? { ...boundaries, models: { ...models, [model]: boundary } } : { ...boundaries, [b.provider]: boundary },
      },
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(merged, null, 2) + "\n")
    ;(ctx.config() as { providers?: Providers }).providers = merged.providers as Providers
    return await view()
  })

  // C-016: how old a card's check may be before a send to its model is refused. Recorded, then saved by adding.
  app.put("/api/providers/boundary-age", async (req, reply) => {
    const file = ctx.configFile
    if (!file) return reply.code(404).send({ error: "Settings cannot be saved here." })
    const days = (req.body as { days?: unknown } | undefined)?.days
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650)
      return reply.code(422).send({ error: "Give a number of days from 1 to 3650." })
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "provider_boundary_changed",
      channel: "desktop",
      tool: "settings",
      cwd: "",
      input: { maxAgeDays: days },
      verdict: {
        outcome: "allow",
        ruleId: "provider-boundary-changed",
        reason: "How old a card saying where your words go may be was set from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    if (!recorded) return reply.code(503).send({ error: "It could not be recorded, so it was not saved." })
    let onDisk: Record<string, unknown> = {}
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    } catch {
      // no settings file yet
    }
    const providers = (onDisk.providers as Record<string, unknown> | undefined) ?? {}
    const boundaries = (providers.boundaries as Record<string, unknown> | undefined) ?? {}
    const merged = { ...onDisk, providers: { ...providers, boundaries: { ...boundaries, maxAgeDays: days } } }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(merged, null, 2) + "\n")
    ;(ctx.config() as { providers?: Providers }).providers = merged.providers as Providers
    return await view()
  })

  app.put("/api/providers", async (req, reply) => {
    const file = ctx.configFile
    if (!file) return reply.code(404).send({ error: "Settings cannot be saved here." })
    const b = (req.body ?? {}) as { enabled?: unknown; local?: unknown; claimJudge?: unknown }
    if (typeof b.enabled !== "boolean")
      return reply.code(400).send({ error: "Say whether other providers are on." })
    // A runtime's settings carry no key, token or password: a gateway holds those itself (ADR 0010, invariant 6).
    const extra =
      b.local && typeof b.local === "object"
        ? Object.keys(b.local).filter((k) => !RUNTIME_FIELDS.has(k))
        : []
    if (extra.length)
      return reply.code(422).send({
        error:
          "A runtime's settings take no key, token or password. A gateway holds the provider's credentials itself.",
      })
    const candidate = GatehouseConfig.shape.providers.safeParse({
      multi: { enabled: b.enabled },
      ...(b.local ? { local: b.local } : {}),
      ...(typeof b.claimJudge === "string" && b.claimJudge ? { claimJudge: { model: b.claimJudge } } : {}),
    })
    if (!candidate.success)
      return reply.code(422).send({
        error: "Those settings are not valid.",
        errors: candidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      })
    const next = candidate.data as Providers
    const where = next.local ? addressProblem(next.local.url) : undefined
    if (where) return reply.code(422).send({ error: where })
    // T-067: a runtime only of a kind the organisation allows; turning them off is always allowed.
    const managed = ctx.managed?.()
    if (next.local && !providerAllowed(managed, next.local.kind === "gateway" ? "gateway" : "local"))
      return reply.code(403).send({ error: managedRefusal(managed, next.local.kind === "gateway" ? "a gateway to hosted models is not allowed" : "models on this computer are not allowed") })
    // D-086: the claims judge sees a change's diff, so only a model listed on a runtime on this computer, never a gateway.
    if (next.claimJudge && !judgeRuntime(next.local as LocalRuntimeConfig | undefined, next.claimJudge.model))
      return reply.code(422).send({ error: "The claims judge must be one of the models you list, on a runtime on this computer (not a gateway)." })
    const recorded = await ctx.audit.record({
      session: "desktop",
      event: "providers_changed",
      channel: "desktop",
      tool: "settings",
      cwd: "",
      input: {
        enabled: next.multi?.enabled === true,
        ...(next.local
          ? { kind: next.local.kind, models: next.local.models.map((m) => m.name) }
          : {}),
        ...(next.claimJudge ? { claimJudge: next.claimJudge.model } : {}),
      },
      verdict: {
        outcome: "allow",
        ruleId: "providers-changed",
        reason: "The settings for other AI providers were changed from the desktop.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    if (!recorded)
      return reply.code(503).send({ error: "It could not be recorded, so it was not saved." })
    // Read tolerantly and change only this setting, so what a newer version wrote is kept.
    let onDisk: Record<string, unknown> = {}
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    } catch {
      // no settings file yet
    }
    const merged = {
      ...onDisk,
      providers: { ...((onDisk.providers as object | undefined) ?? {}), ...next } as Record<string, unknown>,
    }
    // D-086: turned off when the page sends none; an older page that does not know it leaves it as it was.
    if (!next.claimJudge && (b.claimJudge === "" || b.claimJudge === null)) delete merged.providers.claimJudge
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(merged, null, 2) + "\n")
    ;(ctx.config() as { providers?: Providers }).providers = merged.providers as Providers
    return await view()
  })
}
