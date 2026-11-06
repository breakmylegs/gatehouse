// B39: a plugin's evaluation, with it and without it, in Plan mode under the Approver.
import { EventEmitter } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  checkSuite,
  EvalStore,
  passes,
  PluginEvaluator,
  summary,
  type EvalSession,
  type EvaluatorDeps,
} from "../src/plugin-eval.js"
import { assertSafeOptions, isSafeInlineSettings } from "../src/safety.js"
import { buildStack, type Stack } from "./stack.js"
import type { HostAudit } from "../src/hostaudit.js"
import type { Options } from "@anthropic-ai/claude-agent-sdk"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-evals-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const folder = path.resolve(dir, "repo")
const suite = (tasks = [{ prompt: "What does it build with?", expect: "vite" }]) => ({
  plugin: "helper@local",
  folder,
  tasks,
})

describe("the inline settings a session may have", () => {
  it("may only turn things off: auto memory, and installed plugins for one session", () => {
    expect(isSafeInlineSettings({ autoMemoryEnabled: false })).toBe(true)
    expect(isSafeInlineSettings({ enabledPlugins: { "helper@local": false } })).toBe(true)
    expect(
      isSafeInlineSettings({ autoMemoryEnabled: false, enabledPlugins: { "helper@local": false } }),
    ).toBe(true)
    // The output style from Settings, by name only (owner's Settings overhaul, 6 Nov).
    expect(isSafeInlineSettings({ outputStyle: "Explanatory" })).toBe(true)
    expect(isSafeInlineSettings({ outputStyle: "My team's notes" })).toBe(false)
    for (const bad of [
      { outputStyle: "../../evil" },
      { outputStyle: "C:\\styles\\x.md" },
      { outputStyle: "" },
      { outputStyle: 3 },
      { outputStyle: "Learning", permissions: { allow: ["Bash(*)"] } },
      { enabledPlugins: { "helper@local": true } },
      { enabledPlugins: { "helper@local": ["1.0"] } },
      { enabledPlugins: { "helper@local": false, "other@x": true } },
      { enabledPlugins: { "not an id": false } },
      { enabledPlugins: {} },
      { enabledPlugins: [] },
      { enabledPlugins: { "helper@local": false }, permissions: { allow: ["Bash(*)"] } },
      { autoMemoryEnabled: true },
      {},
      null,
      "settings.json",
    ])
      expect(isSafeInlineSettings(bad), JSON.stringify(bad)).toBe(false)
    const safe = (settings: unknown) =>
      ({
        cwd: "C:/dev/x",
        permissionMode: "plan",
        env: { PATH: "x" },
        canUseTool: async () => ({ behavior: "deny", message: "x" }),
        hooks: { PreToolUse: [{ hooks: [async () => ({})] }] },
        settings,
      }) as unknown as Options
    expect(() => assertSafeOptions(safe({ enabledPlugins: { "a@b": false } }))).not.toThrow()
    expect(() => assertSafeOptions(safe({ enabledPlugins: { "a@b": true } }))).toThrow(
      /inline settings/,
    )
  })
})

describe("an evaluation's tasks", () => {
  it("passes an answer that says the words, whatever the case, or matches the pattern", () => {
    expect(passes("It builds with Vite 6.", "vite")).toBe(true)
    expect(passes("It builds with webpack.", "vite")).toBe(false)
    expect(passes("Port 5173 is used", "/port \\d{4}/i")).toBe(true)
    expect(passes("no number", "/port \\d{4}/i")).toBe(false)
  })

  it("are refused when a part is missing, too long, or a pattern does not parse", () => {
    expect(checkSuite(suite()).tasks).toHaveLength(1)
    expect(() => checkSuite({ ...suite(), plugin: "helper" })).toThrow(/name@marketplace/)
    expect(() => checkSuite({ ...suite(), folder: "relative" })).toThrow(/folder/)
    expect(() => checkSuite(suite([]))).toThrow(/between 1 and 20/)
    expect(() => checkSuite(suite([{ prompt: "x", expect: "" }]))).toThrow(/good answer/)
    expect(() => checkSuite(suite([{ prompt: "x", expect: "/(/" }]))).toThrow(/pattern/)
  })

  it("are kept with each one's last run, and a run cut off by a restart reads as stopped", async () => {
    const file = path.join(dir, `s-${++n}.json`)
    const store = new EvalStore(file)
    await store.put(suite())
    await store.setRun("helper@local", {
      startedAt: "x",
      state: "running",
      total: 2,
      results: [],
    })
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    fs.writeFileSync(file, JSON.stringify({ ...raw, fromNewer: 1 }))
    const again = new EvalStore(file)
    expect(again.get("helper@local")?.last?.state).toBe("stopped")
    await again.put(suite())
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ fromNewer: 1 })
  })
})

/** A session that answers each prompt with what `say` returns, or fails. */
class FakeSession extends EventEmitter implements EvalSession {
  closed = false
  constructor(readonly say: (prompt: string) => string | Error) {
    super()
  }
  prompt(text: string): void {
    const a = this.say(text)
    queueMicrotask(() =>
      a instanceof Error
        ? this.emit("state", { state: "error", error: a.message })
        : this.emit("message", { type: "result", result: a, total_cost_usd: 0.02 }),
    )
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

function evaluator(over: Partial<EvaluatorDeps> = {}) {
  const records: Array<{ event: string; input?: unknown }> = []
  const starts: Array<{ evaluation: { plugin: string; with: boolean }; mode: string }> = []
  const sessions: FakeSession[] = []
  const audit = {
    fail: false,
    async record(r: { event: string; input?: unknown }) {
      if (audit.fail) return false
      records.push(r)
      return true
    },
  }
  const store = new EvalStore(path.join(dir, `e-${++n}.json`))
  const ev = new PluginEvaluator({
    store,
    start: async (o) => {
      starts.push(o)
      const s = new FakeSession((p) =>
        o.evaluation.with ? `With the plugin: ${p} vite` : "no idea",
      )
      sessions.push(s)
      return s
    },
    enabled: async () => true,
    audit: audit as unknown as HostAudit,
    policyHash: () => "h",
    log: () => undefined,
    ...over,
  })
  const finished = () =>
    new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (!ev.current()) {
          clearInterval(t)
          resolve()
        }
      }, 5)
    })
  return { ev, store, records, starts, sessions, audit, finished }
}

describe("running an evaluation", () => {
  it("runs each task with the plugin and without it, in Plan mode, and gives the pass rate both ways", async () => {
    const { ev, store, records, starts, sessions, finished } = evaluator()
    await store.put(
      suite([
        { prompt: "Quokka question", expect: "vite" },
        { prompt: "Wombat question", expect: "vite" },
      ]),
    )
    const run = await ev.start("helper@local")
    expect(run).toMatchObject({ state: "running", total: 4 })
    await expect(ev.start("helper@local")).rejects.toThrow(/already running/)
    await finished()
    expect(starts.map((s) => [s.mode, s.evaluation.with])).toEqual([
      ["plan", true],
      ["plan", false],
      ["plan", true],
      ["plan", false],
    ])
    expect(sessions.every((s) => s.closed)).toBe(true)
    const last = store.get("helper@local")?.last
    expect(last?.state).toBe("done")
    expect(summary(last!)).toEqual({ with: { passed: 2, of: 2 }, without: { passed: 0, of: 2 } })
    expect(records.map((r) => r.event)).toEqual(["plugin_eval_started", "plugin_eval_finished"])
    // On the record by plugin and counts, never by the prompts.
    expect(JSON.stringify(records)).not.toMatch(/Quokka|Wombat/)
  })

  it("counts a run that stops, or never starts, as not passed, with why", async () => {
    let k = 0
    const { ev, store, finished } = evaluator({
      start: async () => {
        if (k++ === 1) throw new Error("the kill switch is on")
        return new FakeSession(() => new Error("Claude Code exited"))
      },
    })
    await store.put(suite())
    await ev.start("helper@local")
    await finished()
    const results = store.get("helper@local")?.last?.results ?? []
    expect(results.map((r) => [r.passed, r.error])).toEqual([
      [false, "Claude Code exited"],
      [false, "It did not start: the kill switch is on"],
    ])
  })

  it("is refused for a plugin that is off or not known to be on, and when it cannot be recorded", async () => {
    const off = evaluator({ enabled: async () => false })
    await off.store.put(suite())
    await expect(off.ev.start("helper@local")).rejects.toThrow(/Turn the plugin on first/)
    const unknown = evaluator({ enabled: async () => undefined })
    await unknown.store.put(suite())
    await expect(unknown.ev.start("helper@local")).rejects.toThrow(/could not tell/)
    const { ev, store, audit, starts } = evaluator()
    await store.put(suite())
    audit.fail = true
    await expect(ev.start("helper@local")).rejects.toThrow(/could not be recorded/)
    expect(starts).toHaveLength(0)
    expect(ev.current()).toBeUndefined()
  })

  it("stops after the run in hand when asked", async () => {
    const { ev, store, starts, finished } = evaluator()
    await store.put(
      suite([
        { prompt: "one", expect: "vite" },
        { prompt: "two", expect: "vite" },
      ]),
    )
    await ev.start("helper@local")
    expect(ev.stop("helper@local")).toBe(true)
    await finished()
    expect(starts.length).toBeLessThan(4)
    expect(store.get("helper@local")?.last?.state).toBe("stopped")
  })
})

describe("an evaluation's session", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(() => s.stop())

  it("turns the plugin off for itself alone without it, and leaves it as installed with it", async () => {
    await s.manager.start({
      cwd: s.repo,
      mode: "plan",
      evaluation: { plugin: "helper@local", with: false },
    })
    const without = s.sdk.queries.at(-1)?.options
    expect(without?.settings).toEqual({ enabledPlugins: { "helper@local": false } })
    expect(without?.permissionMode).toBe("plan")
    const w = await s.manager.start({
      cwd: s.repo,
      mode: "plan",
      evaluation: { plugin: "helper@local", with: true },
    })
    expect(s.sdk.queries.at(-1)?.options.settings).toBeUndefined()
    expect(w.info().evaluation).toEqual({ plugin: "helper@local", with: true })
  })
})
