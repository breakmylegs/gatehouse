import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "./hostaudit.js"

/**
 * CH-01 (owner's Chat build, 4 Nov): the window app cancels every navigation away from Codehouse's own page
 * (packaging/NavGuard.cs) and tells the Host here, so each one is in the audit log. It sends only the scheme and host,
 * never the path or query.
 */
export const ShellNavigation = z.object({
  where: z.enum(["window", "frame", "new-window"]),
  target: z
    .string()
    .max(120)
    .regex(/^[a-z0-9.\-:/[\]]*$/),
  opened: z.boolean(),
})
export type ShellNavigation = z.infer<typeof ShellNavigation>

/** A page that keeps trying the same address is one entry every few seconds, not thousands. */
export const REPEAT_MS = 5_000

export class NavigationAudit {
  readonly #last = new Map<string, number>()

  constructor(
    private readonly audit: HostAudit,
    private readonly policyHash: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records the navigation, unless the same one was recorded moments ago. Says whether it recorded it. */
  async note(n: ShellNavigation): Promise<boolean> {
    const key = `${n.where} ${n.target} ${n.opened}`
    const at = this.now()
    const last = this.#last.get(key)
    if (last !== undefined && at - last < REPEAT_MS) return false
    this.#last.set(key, at)
    if (this.#last.size > 500) this.#last.delete(this.#last.keys().next().value!)
    return this.audit.record({
      session: "desktop",
      event: "navigation_refused",
      channel: "desktop",
      tool: "webview",
      input: n,
      verdict: {
        outcome: "deny",
        ruleId: "webview-own-origin",
        reason: n.opened
          ? "The window shows only Codehouse's own page, so the link opened in your browser instead."
          : "The window shows only Codehouse's own page, so this was stopped.",
        risk: 0,
        decidedBy: "floor",
        policyHash: this.policyHash(),
      },
      latencyMs: 0,
    })
  }
}

export function registerShellRoutes(app: FastifyInstance, nav: NavigationAudit): void {
  app.post("/api/shell/navigation", async (req, reply) => {
    const parsed = ShellNavigation.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: "not a navigation" })
    await nav.note(parsed.data)
    return { ok: true }
  })
}
