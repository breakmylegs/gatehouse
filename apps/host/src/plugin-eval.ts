import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"

/**
 * B39: a plugin's evaluation. You write a few tasks for a folder, each with what a good answer says, and Codehouse runs
 * each task twice in Plan mode, once with the plugin and once without it, as normal sessions under the Approver. The
 * result is the pass rate both ways, so you can see whether a plugin earns its place.
 *
 * Plan mode, because an evaluation should change nothing: a session may read and answer, and every call still goes
 * through the floor, the Approver and the audit. Without the plugin, it is turned off for that session alone (inline
 * settings may only turn things off, see safety.ts); with it, it runs as installed, so it must be installed and on.
 * Runs are one at a time, and each start and finish is recorded, by plugin and counts, never by the prompts.
 */

export const MAX_TASKS = 20
const MAX_PROMPT = 8000
const MAX_EXPECT = 300
/** One run's longest wait for Claude's answer. */
export const RUN_TIMEOUT_MS = 10 * 60_000
const PLUGIN_ID = /^[\w.-]+@[\w.-]+$/

export interface EvalTask {
  prompt: string
  /** What a passing answer says: words it contains (case does not matter), or /a pattern/ with optional flags. */
  expect: string
}

export interface EvalSuite {
  plugin: string
  /** The folder the sessions run in. */
  folder: string
  tasks: EvalTask[]
}

export interface EvalResult {
  task: number
  with: boolean
  passed: boolean
  costUsd?: number
  /** Why the run gave no answer: it did not start, stopped, or took too long. */
  error?: string
}

export interface EvalRun {
  startedAt: string
  finishedAt?: string
  state: "running" | "done" | "stopped" | "failed"
  error?: string
  /** How many runs there are in all: two for each task. */
  total: number
  results: EvalResult[]
}

export class EvalError extends Error {
  constructor(
    readonly code: "bad" | "busy" | "missing" | "off" | "unrecorded",
    message: string,
  ) {
    super(message)
  }
}

/** A suite as given, checked, or an error saying what is wrong with it. */
export function checkSuite(raw: unknown): EvalSuite {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const plugin = typeof r.plugin === "string" ? r.plugin : ""
  if (!PLUGIN_ID.test(plugin)) throw new EvalError("bad", "Say which plugin, as name@marketplace.")
  const folder = typeof r.folder === "string" ? r.folder.trim() : ""
  if (!folder || !path.isAbsolute(folder))
    throw new EvalError("bad", "Choose the folder the tasks run in.")
  const tasks = Array.isArray(r.tasks) ? r.tasks : []
  if (!tasks.length || tasks.length > MAX_TASKS)
    throw new EvalError("bad", `An evaluation needs between 1 and ${MAX_TASKS} tasks.`)
  return {
    plugin,
    folder,
    tasks: tasks.map((t, i) => {
      const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>
      const prompt = typeof o.prompt === "string" ? o.prompt.trim() : ""
      const expect = typeof o.expect === "string" ? o.expect.trim() : ""
      if (!prompt || prompt.length > MAX_PROMPT)
        throw new EvalError("bad", `Task ${i + 1} needs a prompt of up to 8,000 characters.`)
      if (!expect || expect.length > MAX_EXPECT)
        throw new EvalError(
          "bad",
          `Task ${i + 1} needs what a good answer says, in up to ${MAX_EXPECT} characters.`,
        )
      if (patternOf(expect) === null)
        throw new EvalError("bad", `Task ${i + 1}'s pattern is not one Codehouse can read.`)
      return { prompt, expect }
    }),
  }
}

/** A /pattern/flags expectation as a RegExp, undefined for plain words, or null for a pattern that does not parse. */
function patternOf(expect: string): RegExp | undefined | null {
  const m = /^\/(.+)\/([imsu]*)$/s.exec(expect)
  if (!m) return undefined
  try {
    return new RegExp(m[1]!, m[2])
  } catch {
    return null
  }
}

/** Whether an answer passes: it says the words (case does not matter), or matches the pattern. */
export function passes(answer: string, expect: string): boolean {
  const re = patternOf(expect)
  if (re === null) return false
  if (re) return re.test(answer)
  return answer.toLowerCase().includes(expect.toLowerCase())
}

/** Passed out of run, with the plugin and without it. */
export function summary(run: EvalRun): Record<"with" | "without", { passed: number; of: number }> {
  const side = (w: boolean) => {
    const rs = run.results.filter((r) => r.with === w)
    return { passed: rs.filter((r) => r.passed).length, of: rs.length }
  }
  return { with: side(true), without: side(false) }
}

/** The suites and each one's last run, kept in one file. Read tolerantly, and only added to. */
export class EvalStore {
  readonly #file: string
  #extra: Record<string, unknown> = {}
  #suites = new Map<string, EvalSuite & { last?: EvalRun }>()

  constructor(file: string) {
    this.#file = file
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      const { suites, ...rest } = raw
      this.#extra = rest
      if (Array.isArray(suites))
        for (const s of suites as Array<Record<string, unknown>>) {
          try {
            const ok = checkSuite(s)
            const last = s.last as EvalRun | undefined
            this.#suites.set(ok.plugin, {
              ...ok,
              ...(last && typeof last === "object" && Array.isArray(last.results)
                ? { last: last.state === "running" ? { ...last, state: "stopped" } : last }
                : {}),
            })
          } catch {
            // a broken one, or one a newer version wrote: left out
          }
        }
    } catch {
      // none yet
    }
  }

  list(): Array<EvalSuite & { last?: EvalRun }> {
    return [...this.#suites.values()].map((s) => structuredClone(s))
  }

  get(plugin: string): (EvalSuite & { last?: EvalRun }) | undefined {
    const s = this.#suites.get(plugin)
    return s && structuredClone(s)
  }

  async #save(): Promise<void> {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(
      this.#file,
      JSON.stringify({ ...this.#extra, version: 1, suites: [...this.#suites.values()] }, null, 2) +
        "\n",
    )
  }

  async put(raw: unknown): Promise<EvalSuite> {
    const ok = checkSuite(raw)
    const was = this.#suites.get(ok.plugin)
    this.#suites.set(ok.plugin, { ...ok, ...(was?.last ? { last: was.last } : {}) })
    await this.#save()
    return ok
  }

  async remove(plugin: string): Promise<boolean> {
    if (!this.#suites.delete(plugin)) return false
    await this.#save()
    return true
  }

  async setRun(plugin: string, run: EvalRun): Promise<void> {
    const s = this.#suites.get(plugin)
    if (!s) return
    s.last = structuredClone(run)
    await this.#save()
  }
}

/** What the evaluator needs of a session: the Host's own Session has these. */
export interface EvalSession {
  prompt(text: string): void
  close(): Promise<void>
  on(event: "message", fn: (m: unknown) => void): unknown
  on(event: "state", fn: (info: { state: string; error?: string }) => void): unknown
  off(event: "message", fn: (m: unknown) => void): unknown
  off(event: "state", fn: (info: { state: string; error?: string }) => void): unknown
}

export interface EvaluatorDeps {
  store: EvalStore
  /** Starts a session the same way as any other, in Plan mode, with the plugin on or off. */
  start: (o: {
    cwd: string
    mode: "plan"
    evaluation: { plugin: string; with: boolean }
  }) => Promise<EvalSession>
  /** Whether the plugin is installed and on; undefined when that cannot be told. */
  enabled: (plugin: string) => Promise<boolean | undefined>
  audit: HostAudit
  policyHash: () => string
  log: (line: string) => void
  timeoutMs?: number
}

/** One task in one session: Claude's answer, or why there was none. */
export function answerOf(
  s: EvalSession,
  prompt: string,
  timeoutMs: number,
): Promise<{ answer?: string; costUsd?: number; error?: string }> {
  return new Promise((resolve) => {
    const done = (r: { answer?: string; costUsd?: number; error?: string }) => {
      clearTimeout(timer)
      s.off("message", onMessage)
      s.off("state", onState)
      resolve(r)
    }
    const onMessage = (m: unknown) => {
      const r = (m ?? {}) as Record<string, unknown>
      if (r.type !== "result") return
      const cost = typeof r.total_cost_usd === "number" ? { costUsd: r.total_cost_usd } : {}
      if (r.is_error === true || typeof r.result !== "string")
        done({ ...cost, error: "Claude's turn ended with an error." })
      else done({ answer: r.result, ...cost })
    }
    const onState = (info: { state: string; error?: string }) => {
      if (info.state === "error" || info.state === "ended")
        done({ error: info.error ?? "The session stopped before it answered." })
    }
    const timer = setTimeout(
      () => done({ error: "It took longer than Codehouse waits for one task." }),
      timeoutMs,
    )
    s.on("message", onMessage)
    s.on("state", onState)
    try {
      s.prompt(prompt)
    } catch (e) {
      done({ error: (e as Error).message })
    }
  })
}

export class PluginEvaluator {
  readonly #d: EvaluatorDeps
  #running?: { plugin: string; run: EvalRun; stop: boolean }

  constructor(d: EvaluatorDeps) {
    this.#d = d
  }

  get store(): EvalStore {
    return this.#d.store
  }

  /** The run going now, if any. */
  current(): { plugin: string; run: EvalRun } | undefined {
    const r = this.#running
    return r && { plugin: r.plugin, run: structuredClone(r.run) }
  }

  #record(event: string, plugin: string, reason: string, extra: Record<string, unknown>) {
    return this.#d.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "plugin-eval",
      cwd: "",
      input: { plugin, ...extra },
      verdict: {
        outcome: "allow",
        ruleId: event.replace(/_/g, "-"),
        reason,
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: this.#d.policyHash(),
      },
      latencyMs: 0,
    })
  }

  /**
   * Starts the plugin's evaluation and returns once it has begun; the runs go on in the background, one at a time.
   * Refused while another runs, for a plugin that is not installed and on, or when it cannot be recorded.
   */
  async start(plugin: string): Promise<EvalRun> {
    if (this.#running) throw new EvalError("busy", "An evaluation is already running.")
    const suite = this.#d.store.get(plugin)
    if (!suite) throw new EvalError("missing", "That plugin has no evaluation yet.")
    const on = await this.#d.enabled(plugin)
    if (on !== true)
      throw new EvalError(
        "off",
        on === false
          ? "Turn the plugin on first: the runs with it use it as installed."
          : "Codehouse could not tell whether the plugin is installed and on.",
      )
    const run: EvalRun = {
      startedAt: new Date().toISOString(),
      state: "running",
      total: suite.tasks.length * 2,
      results: [],
    }
    this.#running = { plugin, run, stop: false }
    const ok = await this.#record(
      "plugin_eval_started",
      plugin,
      "A plugin's evaluation was started from the desktop.",
      { tasks: suite.tasks.length },
    ).catch(() => false)
    if (!ok) {
      this.#running = undefined
      throw new EvalError("unrecorded", "It could not be recorded, so it did not start.")
    }
    await this.#d.store.setRun(plugin, run)
    void this.#go(suite)
    return structuredClone(run)
  }

  /** Stops the evaluation after the run in hand. */
  stop(plugin: string): boolean {
    if (this.#running?.plugin !== plugin) return false
    this.#running.stop = true
    return true
  }

  async #go(suite: EvalSuite): Promise<void> {
    const r = this.#running!
    try {
      // With and without in turn for each task, so the two sides meet the same conditions.
      for (const [task, t] of suite.tasks.entries())
        for (const side of [true, false]) {
          if (r.stop) {
            r.run.state = "stopped"
            return
          }
          const one = await this.#once(suite, t, side)
          r.run.results.push({
            task,
            with: side,
            passed: one.answer !== undefined && passes(one.answer, t.expect),
            ...(one.costUsd !== undefined ? { costUsd: one.costUsd } : {}),
            ...(one.error ? { error: one.error } : {}),
          })
          await this.#d.store.setRun(suite.plugin, r.run)
        }
      r.run.state = "done"
    } catch (e) {
      r.run.state = "failed"
      r.run.error = (e as Error).message
    } finally {
      r.run.finishedAt = new Date().toISOString()
      this.#running = undefined
      await this.#d.store.setRun(suite.plugin, r.run).catch(() => undefined)
      const s = summary(r.run)
      await this.#record(
        "plugin_eval_finished",
        suite.plugin,
        `A plugin's evaluation ${r.run.state === "done" ? "finished" : r.run.state}.`,
        { with: s.with, without: s.without, state: r.run.state },
      ).catch(() => false)
    }
  }

  async #once(
    suite: EvalSuite,
    t: EvalTask,
    side: boolean,
  ): Promise<{ answer?: string; costUsd?: number; error?: string }> {
    let s: EvalSession
    try {
      s = await this.#d.start({
        cwd: suite.folder,
        mode: "plan",
        evaluation: { plugin: suite.plugin, with: side },
      })
    } catch (e) {
      return { error: `It did not start: ${(e as Error).message}` }
    }
    try {
      return await answerOf(s, t.prompt, this.#d.timeoutMs ?? RUN_TIMEOUT_MS)
    } finally {
      await s.close().catch((e: Error) => this.#d.log(`evaluation session close: ${e.message}`))
    }
  }
}

/** B39's routes. Desktop only, like the marketplace. */
export function registerEvalRoutes(
  app: FastifyInstance,
  ctx: { evals?: PluginEvaluator; audit: HostAudit },
): void {
  const evals = ctx.evals
  if (!evals) return
  const code = (e: EvalError) =>
    e.code === "bad"
      ? 400
      : e.code === "missing"
        ? 404
        : e.code === "busy" || e.code === "off"
          ? 409
          : 503
  const fail = (e: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (e instanceof EvalError) return reply.code(code(e)).send({ error: e.message })
    throw e
  }
  app.get("/api/plugin-evals", async () => ({
    suites: evals.store.list(),
    ...(evals.current() ? { running: evals.current()?.plugin } : {}),
  }))
  app.put("/api/plugin-evals", async (req, reply) => {
    try {
      return { suite: await evals.store.put(req.body) }
    } catch (e) {
      return fail(e, reply)
    }
  })
  app.delete<{ Params: { plugin: string } }>("/api/plugin-evals/:plugin", async (req, reply) => {
    if (evals.current()?.plugin === req.params.plugin)
      return reply.code(409).send({ error: "Stop its evaluation first." })
    return (await evals.store.remove(req.params.plugin))
      ? { ok: true }
      : reply.code(404).send({ error: "That plugin has no evaluation." })
  })
  app.post<{ Params: { plugin: string } }>("/api/plugin-evals/:plugin/run", async (req, reply) => {
    try {
      return { run: await evals.start(req.params.plugin) }
    } catch (e) {
      return fail(e, reply)
    }
  })
  app.post<{ Params: { plugin: string } }>("/api/plugin-evals/:plugin/stop", async (req, reply) =>
    evals.stop(req.params.plugin)
      ? { ok: true }
      : reply.code(404).send({ error: "That evaluation is not running." }),
  )
}
