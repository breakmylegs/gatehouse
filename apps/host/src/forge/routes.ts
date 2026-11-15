import type { FastifyInstance } from "fastify"
import type { HostAudit } from "../hostaudit.js"
import { ForgeError, listPullRequests, viewPullRequest, type Gh } from "./github.js"

/**
 * T-061: GET /api/forge/prs and /api/forge/pr, for a running session's repository, only while the GitHub connection
 * is on. Each read is recorded (which session, what was read), never what came back.
 */
export function registerForgeRoutes(
  app: FastifyInstance,
  d: {
    enabled: () => boolean
    sessionCwd: (id: string) => string | undefined
    audit: Pick<HostAudit, "record">
    gh?: Gh
  },
): void {
  const read = async (
    q: Record<string, unknown>,
    what: Record<string, unknown>,
    fn: (cwd: string) => Promise<unknown>,
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    if (!d.enabled()) return reply.code(403).send({ error: "The GitHub connection is off. Switch it on in Settings, Connectors." })
    const cwd = typeof q.session === "string" ? d.sessionCwd(q.session) : undefined
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    await d.audit.record({
      session: String(q.session),
      event: "forge_read",
      channel: "desktop",
      tool: "github",
      cwd,
      input: what,
      verdict: {
        outcome: "allow",
        ruleId: "forge-read",
        reason: "Codehouse read pull requests from GitHub through gh, with the connection you switched on.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    try {
      return await fn(cwd)
    } catch (e) {
      return reply.code(e instanceof ForgeError ? 409 : 500).send({ error: (e as Error).message })
    }
  }
  app.get("/api/forge/prs", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    return read(q, { list: true }, async (cwd) => ({ prs: await listPullRequests(cwd, d.gh) }), reply)
  })
  app.get("/api/forge/pr", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const n = Number(q.number)
    return read(q, { number: n }, async (cwd) => ({ pr: await viewPullRequest(cwd, n, d.gh) }), reply)
  })
}
