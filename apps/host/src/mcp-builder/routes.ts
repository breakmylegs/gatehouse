/**
 * O39: the MCP page's routes and /mcp <name> in a code session. Behind the admin guard like every route (invariant 7).
 * Each change is recorded first (invariant 13); a change that cannot be recorded is not made.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "../hostaudit.js"
import type { McpRunner } from "./runner.js"
import { SERVER_NAME, type BuiltServers } from "./store.js"

export interface McpRouteDeps {
  store: BuiltServers
  runner: McpRunner
  audit: Pick<HostAudit, "record">
  /** Starts a code session in a server's folder that builds it, with these running servers given to it. */
  startBuilder: (o: { name: string; folder: string; others: string[] }) => Promise<string>
  /** Gives a running session a built server; throws when there is no such session. */
  useInSession: (sessionId: string, name: string) => Promise<void>
}

const Name = z.string().regex(SERVER_NAME)
const Change = z.object({
  autostart: z.boolean().optional(),
  cpu: z.number().int().min(0).max(100).optional(),
  memoryMb: z.number().int().min(0).max(65536).optional(),
})

export function registerMcpBuilderRoutes(app: FastifyInstance, d: McpRouteDeps): void {
  const record = (event: string, name: string, input: Record<string, unknown> = {}, session = "desktop") =>
    d.audit
      .record({
        session,
        event,
        channel: "desktop",
        tool: "mcp-builder",
        input: { name, ...input },
        verdict: { outcome: "allow", ruleId: event.replace(/_/g, "-"), reason: `You did this in Codehouse, MCP (${name}).`, risk: 0, decidedBy: "human-desktop", policyHash: "" },
        latencyMs: 0,
      })
      .catch(() => false)
  const view = (name: string) => {
    const s = d.store.get(name)
    return s ? { ...s, ...d.runner.status(name) } : undefined
  }
  const nameOf = (p: unknown) => Name.safeParse((p as { name?: unknown }).name)

  app.get("/api/mcp-servers", async () => ({ servers: d.store.list().map((s) => view(s.name)) }))

  app.post("/api/mcp-servers", async (req, reply) => {
    const n = nameOf(req.body)
    if (!n.success) return reply.code(400).send({ error: "A name of 2 to 31 lower case letters, digits and dashes, starting with a letter." })
    if (d.store.get(n.data)) return reply.code(409).send({ error: `There is already a server called ${n.data}.` })
    if (!(await record("mcp_server_created", n.data))) return reply.code(503).send({ error: "It could not be recorded, so nothing was made." })
    await d.store.create(n.data)
    return view(n.data)
  })

  app.patch("/api/mcp-servers/:name", async (req, reply) => {
    const n = nameOf(req.params)
    const c = Change.safeParse(req.body)
    if (!n.success || !d.store.get(n.data)) return reply.code(404).send({ error: "There is no such server." })
    if (!c.success) return reply.code(400).send({ error: "The processor share is 0 to 100, the memory 0 to 65536 MB (0 for no cap)." })
    if (!(await record("mcp_server_changed", n.data, c.data))) return reply.code(503).send({ error: "It could not be recorded, so nothing changed." })
    try {
      await d.store.update(n.data, c.data)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
    return view(n.data)
  })

  for (const action of ["start", "stop", "restart"] as const)
    app.post(`/api/mcp-servers/:name/${action}`, async (req, reply) => {
      const n = nameOf(req.params)
      if (!n.success || !d.store.get(n.data)) return reply.code(404).send({ error: "There is no such server." })
      if (!(await record(`mcp_server_${action}`, n.data))) return reply.code(503).send({ error: "It could not be recorded, so nothing was done." })
      await d.runner[action](n.data)
      return view(n.data)
    })

  app.delete("/api/mcp-servers/:name", async (req, reply) => {
    const n = nameOf(req.params)
    if (!n.success || !d.store.get(n.data)) return reply.code(404).send({ error: "There is no such server." })
    if (!(await record("mcp_server_removed", n.data))) return reply.code(503).send({ error: "It could not be recorded, so nothing was removed." })
    await d.runner.stop(n.data)
    await d.store.remove(n.data)
    return { removed: n.data, folderKept: d.store.folder(n.data) }
  })

  // The session that builds it: in its folder, with the other servers that are running given to it to call.
  app.post("/api/mcp-servers/:name/build", async (req, reply) => {
    const n = nameOf(req.params)
    if (!n.success || !d.store.get(n.data)) return reply.code(404).send({ error: "There is no such server." })
    const others = d.runner.all().filter((s) => s.state === "running" && s.name !== n.data).map((s) => s.name)
    if (!(await record("mcp_server_build_session", n.data, { others }))) return reply.code(503).send({ error: "It could not be recorded, so no session was started." })
    const sessionId = await d.startBuilder({ name: n.data, folder: d.store.folder(n.data), others })
    return { sessionId }
  })

  // /mcp <name> in a code session.
  app.post("/api/sessions/:id/mcp", async (req, reply) => {
    const id = String((req.params as { id: string }).id)
    const n = nameOf(req.body)
    if (!n.success || !d.store.get(n.data)) return reply.code(404).send({ error: "There is no MCP server by that name. Make it in Codehouse, MCP." })
    if (d.runner.status(n.data).state !== "running") return reply.code(409).send({ error: `${n.data} is not running. Start it in Codehouse, MCP, first.` })
    if (!(await record("mcp_server_used", n.data, {}, id))) return reply.code(503).send({ error: "It could not be recorded, so the session was not given it." })
    try {
      await d.useInSession(id, n.data)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
    return { name: n.data, tools: d.runner.status(n.data).tools.map((t) => t.name) }
  })
}
