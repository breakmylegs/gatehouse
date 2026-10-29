/**
 * The admin API for updates. Looking, skipping and changing how often to look are plain settings. Switching to a
 * new version closes JCVC and is only done when the desktop asks for that exact version.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import type { AdminContext } from "./api.js"
import { UpdateError } from "./update/source.js"

const Version = z.object({ version: z.string().min(1).max(60) })
const Settings = z
  .object({
    checkEveryMinutes: z.number().int().optional(),
    downloadInBackground: z.boolean().optional(),
  })
  .strict()
const Token = z.object({ token: z.string().min(1).max(300) }).strict()

export function registerUpdateRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const u = ctx.updates
  if (!u) return
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof UpdateError || e instanceof Error)
      return reply.code(e instanceof UpdateError ? 409 : 500).send({ error: e.message })
    return reply.code(500).send({ error: String(e) })
  }
  const body = <T>(schema: z.ZodType<T>, raw: unknown, reply: FastifyReply): T | undefined => {
    const r = schema.safeParse(raw ?? {})
    if (r.success) return r.data
    void reply.code(422).send({ error: "That request is not valid." })
    return undefined
  }

  app.get("/api/update", async () => u.status())
  app.post("/api/update/check", async () => u.check())
  for (const [route, act] of [
    ["prepare", (v: string) => u.prepare(v)],
    ["install", (v: string) => u.install(v)],
    ["apply", (v: string) => u.apply(v)],
    ["skip", (v: string) => u.skip(v)],
    ["unskip", (v: string) => u.unskip(v)],
  ] as const)
    app.post(`/api/update/${route}`, async (req, reply) => {
      const b = body(Version, req.body, reply)
      if (!b) return reply
      try {
        return await act(b.version)
      } catch (e) {
        return fail(reply, e)
      }
    })
  app.put("/api/update/settings", async (req, reply) => {
    const b = body(Settings, req.body, reply)
    if (!b) return reply
    try {
      return await u.setSettings(b)
    } catch (e) {
      return fail(reply, e)
    }
  })
  app.post("/api/update/rollback", async (_req, reply) => {
    try {
      return await u.rollback()
    } catch (e) {
      return fail(reply, e)
    }
  })
  app.post("/api/update/dismiss", async () => u.dismissResult())
  // The token is write-only: saved sealed, never sent back.
  app.put("/api/update/token", async (req, reply) => {
    const b = body(Token, req.body, reply)
    if (!b) return reply
    if (!ctx.updateToken) return reply.code(404).send({ error: "Tokens cannot be kept here." })
    try {
      await ctx.updateToken.save(b.token.trim())
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message })
    }
    return u.check()
  })
  app.delete("/api/update/token", async () => {
    ctx.updateToken?.forget()
    return u.status()
  })
}
