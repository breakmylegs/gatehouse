import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import type { ActionResult } from "../codehouse-action.js"
import type { HostAudit } from "../hostaudit.js"
import { scanForInjection } from "../injection-scan.js"
import { prCommand, PrActionError, prNumber, toggleTask, type PrAction } from "./actions.js"
import { ForgeError, listPullRequests, stackOf, viewPullRequest, viewThread, type Gh } from "./github.js"
import type { PrWatcher } from "./watch.js"

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
    /** T-080: watching pull requests for sessions. */
    watcher?: PrWatcher
    /** T-075: a gh command run as a Codehouse action for a session, judged as the session's own would be. */
    act?: (sessionId: string, cwd: string, command: string, why: string) => Promise<ActionResult>
    /** Output redacted before it is shown. */
    redact?: (s: string) => string
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
  // T-080: watch a pull request for a session, or stop; recorded. Desktop only, while the connection is on.
  app.post("/api/forge/watch", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    if (!d.watcher) return reply.code(501).send({ error: "Watching is not available here." })
    const n = Number(b.number)
    if (!Number.isInteger(n) || n < 1) return reply.code(422).send({ error: "That is not a pull request number." })
    if (b.on === false) {
      d.watcher.unwatch(String(b.session), n)
      return { watching: false }
    }
    return read(
      b,
      { watch: n },
      async (cwd) => {
        await d.watcher!.watch(String(b.session), cwd, n)
        return { watching: true }
      },
      reply,
    )
  })
  // T-075: its description, comments and reviews, each of others' words flagged when it reads like an instruction.
  app.get("/api/forge/thread", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const n = Number(q.number)
    return read(q, { thread: n }, async (cwd) => ({ thread: await viewThread(cwd, n, (t) => scanForInjection(t).length > 0, d.gh) }), reply)
  })

  // T-075: a change to a pull request, as a gh command on the approval card. The body text goes through a file.
  app.post("/api/forge/act", async (req, reply) => {
    if (!d.enabled()) return reply.code(403).send({ error: "The GitHub connection is off. Switch it on in Settings, Connectors." })
    if (!d.act) return reply.code(501).send({ error: "Changing pull requests is not available here." })
    const b = (req.body ?? {}) as Record<string, unknown>
    const session = typeof b.session === "string" ? b.session : ""
    const cwd = d.sessionCwd(session)
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    let tmp: string | undefined
    try {
      const n = prNumber(b.number)
      const text = (max: number) => {
        if (typeof b.text !== "string" || !b.text.trim() || b.text.length > max) throw new PrActionError("Write something first (at most 60,000 characters).")
        tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codehouse-pr-")), "body.md")
        fs.writeFileSync(tmp, b.text)
        return tmp
      }
      const method = b.method === "squash" || b.method === "rebase" ? b.method : "merge"
      let action: PrAction
      switch (b.action) {
        case "comment":
          action = { kind: "comment", bodyFile: text(60_000) }
          break
        case "request-reviewers":
          action = { kind: "request-reviewers", logins: typeof b.logins === "string" ? b.logins.split(/[\s,]+/) : [] }
          break
        case "checkout":
          action = { kind: "checkout" }
          break
        case "merge":
          action = { kind: "merge", method }
          break
        case "auto-merge":
          action = { kind: "auto-merge", on: b.on !== false, method }
          break
        case "revert":
          action = { kind: "revert" }
          break
        case "tick": {
          // The description as GitHub has it now, with one box changed: nothing else of it is touched.
          const thread = await viewThread(cwd, n, () => false, d.gh)
          const index = Number(b.index)
          if (!Number.isInteger(index) || index < 0) throw new PrActionError("Which box?")
          const next = toggleTask(thread.body, index, b.on !== false)
          if (next === thread.body) throw new PrActionError("That box is already as you asked, or is not there.")
          b.text = next
          action = { kind: "edit-body", bodyFile: text(65_536) }
          break
        }
        default:
          throw new PrActionError("Comment, request reviewers, check out, merge, auto-merge, revert or tick a box.")
      }
      const { command, why } = prCommand(n, action)
      const r = await d.act(session, cwd, command, why)
      const out = (d.redact ?? ((x: string) => x))(r.output).slice(-4000)
      return { ran: r.ran, ...(r.refused ? { refused: r.refused } : {}), exitCode: r.exitCode, output: out }
    } catch (e) {
      if (e instanceof PrActionError || e instanceof ForgeError) return reply.code(422).send({ error: e.message })
      throw e
    } finally {
      if (tmp) fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
    }
  })

  // T-081: the stack a pull request is in, bottom first.
  app.get("/api/forge/stack", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const n = Number(q.number)
    return read(q, { stack: n }, async (cwd) => ({ stack: stackOf(await listPullRequests(cwd, d.gh), n) }), reply)
  })

  // T-081: merge, or rebase, a whole stack, bottom up, one gh command (and one approval card) at a time; it stops at
  // the first that does not go through, and says how far it got.
  app.post("/api/forge/stack", async (req, reply) => {
    if (!d.enabled()) return reply.code(403).send({ error: "The GitHub connection is off. Switch it on in Settings, Connectors." })
    if (!d.act) return reply.code(501).send({ error: "Changing pull requests is not available here." })
    const b = (req.body ?? {}) as Record<string, unknown>
    const session = typeof b.session === "string" ? b.session : ""
    const cwd = d.sessionCwd(session)
    if (!cwd) return reply.code(404).send({ error: "That session is not running." })
    if (b.action !== "merge" && b.action !== "rebase") return reply.code(422).send({ error: "Merge stack or Rebase stack." })
    let stack
    try {
      stack = stackOf(await listPullRequests(cwd, d.gh), prNumber(b.number))
    } catch (e) {
      if (e instanceof PrActionError || e instanceof ForgeError) return reply.code(422).send({ error: e.message })
      throw e
    }
    if (stack.length < 2) return reply.code(422).send({ error: "That pull request is not in a stack." })
    const method = b.method === "merge" || b.method === "rebase" ? b.method : "squash"
    const steps: Array<{ number: number; ran: boolean; exitCode: number | null; refused?: string }> = []
    for (const pr of stack) {
      const { command, why } = prCommand(pr.number, b.action === "merge" ? { kind: "merge", method } : { kind: "update-branch" })
      const r = await d.act(session, cwd, command, `${why}, ${stack.indexOf(pr) + 1} of ${stack.length} in its stack`)
      steps.push({ number: pr.number, ran: r.ran, exitCode: r.exitCode, ...(r.refused ? { refused: r.refused } : {}) })
      if (!r.ran || r.exitCode !== 0) break
    }
    return { stack: stack.map((p) => p.number), steps, done: steps.length === stack.length && steps.every((s) => s.ran && s.exitCode === 0) }
  })

  app.get("/api/forge/pr", async (req, reply) => {
    const q = req.query as Record<string, unknown>
    const n = Number(q.number)
    return read(q, { number: n }, async (cwd) => ({ pr: await viewPullRequest(cwd, n, d.gh) }), reply)
  })
}
