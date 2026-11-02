import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { GatehouseConfig, writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "../hostaudit.js"
import {
  addressProblem,
  checkRuntime,
  runtimeLabel,
  RUNTIME_FIELDS,
  type LocalRuntimeConfig,
} from "./local-runtime.js"

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
  },
): void {
  const view = async () => {
    const p = ctx.config().providers
    const enabled = p?.multi?.enabled === true
    const local = p?.local as LocalRuntimeConfig | undefined
    return {
      enabled,
      ...(local ? { local, label: runtimeLabel(local) } : {}),
      ...(enabled && local ? { check: await checkRuntime(local, ctx.fetchFn) } : {}),
    }
  }

  app.get("/api/providers", async () => await view())

  app.put("/api/providers", async (req, reply) => {
    const file = ctx.configFile
    if (!file) return reply.code(404).send({ error: "Settings cannot be saved here." })
    const b = (req.body ?? {}) as { enabled?: unknown; local?: unknown }
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
    })
    if (!candidate.success)
      return reply.code(422).send({
        error: "Those settings are not valid.",
        errors: candidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      })
    const next = candidate.data as Providers
    const where = next.local ? addressProblem(next.local.url) : undefined
    if (where) return reply.code(422).send({ error: where })
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
      providers: { ...((onDisk.providers as object | undefined) ?? {}), ...next },
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(merged, null, 2) + "\n")
    ;(ctx.config() as { providers?: Providers }).providers = merged.providers as Providers
    return await view()
  })
}
