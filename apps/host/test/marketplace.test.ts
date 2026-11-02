// W1-19: the marketplace lists what each plugin holds, refuses hooks, outside servers, plugins it cannot read first
// and plugins brought along with another, installs through Claude Code only once the install is recorded, and reads
// the installed copy again.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  binaryRunner,
  Marketplace,
  registerMarketplaceRoutes,
  type RunResult,
  type Runner,
} from "../src/marketplace.js"
import { findClaudeBinary } from "../src/signin.js"

let dir: string
let market: string
const w = (p: string, t: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, t)
}

/** A marketplace as Claude Code keeps one: its catalogue, and the plugins whose files are in it. */
function recordedMarketplace(root: string) {
  w(
    path.join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "test-market",
      owner: { name: "test" },
      plugins: [
        {
          name: "plain",
          source: "./plugins/plain",
          description: "A command and a skill",
          version: "1.0.0",
        },
        { name: "hooky", source: "./plugins/hooky" },
        { name: "servers", source: "./plugins/servers" },
        {
          name: "declared",
          source: "./plugins/plain-too",
          mcpServers: { db: { command: "db.exe" } },
        },
        { name: "remote", source: { source: "github", repo: "someone/plugin" } },
        { name: "escape", source: "../outside" },
        { name: "brings", source: "./plugins/brings" },
      ],
    }),
  )
  w(path.join(root, "plugins", "plain", ".claude-plugin", "plugin.json"), '{"name":"plain"}')
  w(path.join(root, "plugins", "plain", "commands", "hello.md"), "Say hello.")
  w(
    path.join(root, "plugins", "plain", "skills", "greet", "SKILL.md"),
    "---\nname: greet\n---\nGreet.",
  )
  w(path.join(root, "plugins", "plain", "agents", "helper.md"), "Help.")
  w(path.join(root, "plugins", "hooky", "hooks", "hooks.json"), '{"hooks":{"SessionStart":[]}}')
  w(path.join(root, "plugins", "servers", ".mcp.json"), '{"mcpServers":{"x":{"command":"x.exe"}}}')
  w(path.join(root, "plugins", "plain-too", "commands", "a.md"), "A.")
  w(
    path.join(root, "plugins", "brings", ".claude-plugin", "plugin.json"),
    '{"name":"brings","dependencies":["hooky"]}',
  )
  w(path.join(root, "..", "outside", "commands", "b.md"), "B.")
}

/** Claude Code's answers, as the probe on 1 Nov recorded them, and every call it was given. */
function fakeClaude(opts: { installPath?: string; installOut?: Record<string, unknown> } = {}) {
  const calls: string[][] = []
  const installed: string[] = []
  const run: Runner = async (args): Promise<RunResult> => {
    calls.push(args)
    const ok = (v: unknown) => ({ code: 0, stdout: JSON.stringify(v), stderr: "" })
    const key = args.slice(0, 3).join(" ")
    if (key === "plugin marketplace list")
      return ok([{ name: "test-market", source: "directory", installLocation: market }])
    if (key === "plugin list --json")
      return ok(
        installed.map((id) => ({
          id,
          version: "1.0.0",
          enabled: true,
          installPath: opts.installPath ?? path.join(market, "plugins", id.split("@")[0]!),
        })),
      )
    if (args[1] === "install") {
      const out = opts.installOut ?? {
        outcome: "ok",
        message: `Successfully installed plugin: ${args[2]}`,
      }
      if (out.outcome === "ok") installed.push(args[2]!)
      return { code: out.outcome === "ok" ? 0 : 1, stdout: JSON.stringify(out), stderr: "" }
    }
    if (args[1] === "uninstall") {
      installed.splice(installed.indexOf(args[2]!), 1)
      return ok({ outcome: "ok", message: `Successfully uninstalled plugin: ${args[2]}` })
    }
    return { code: 1, stdout: "", stderr: "unknown" }
  }
  return { run, calls }
}

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-market-")))
  market = path.join(dir, "market")
  recordedMarketplace(market)
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the catalogue", () => {
  it("lists each plugin with what it holds, and why one is refused", async () => {
    const { plugins } = await new Marketplace(fakeClaude().run).catalogue()
    const by = Object.fromEntries(plugins.map((p) => [p.name, p]))
    expect(by.plain).toMatchObject({
      id: "plain@test-market",
      version: "1.0.0",
      contents: { commands: 1, skills: 1, agents: 1, hooks: false, mcpServers: false },
    })
    expect(by.plain!.refusal).toBeUndefined()
    expect(by.hooky!.refusal).toMatch(/hooks/)
    expect(by.servers!.refusal).toMatch(/MCP servers/)
    expect(by.declared!.refusal).toMatch(/MCP servers/)
    expect(by.remote!.contents).toBeUndefined()
    expect(by.remote!.refusal).toMatch(/cannot read what it holds/)
    expect(by.escape!.refusal).toMatch(/cannot read what it holds/)
    expect(by.brings!.refusal).toMatch(/other plugins/)
  })
})

describe("installing", () => {
  function appWith(run: Runner, audited = true) {
    const records: Array<Record<string, unknown>> = []
    const app = Fastify()
    registerMarketplaceRoutes(app, {
      marketplace: new Marketplace(run),
      audit: { record: async (e: Record<string, unknown>) => (records.push(e), audited) } as never,
    })
    return { app, records }
  }
  const post = (app: ReturnType<typeof Fastify>, action: string, id: string) =>
    app.inject({ method: "POST", url: `/api/marketplace/${action}`, payload: { id } })

  it("installs through Claude Code once the install is recorded, and never confirms a command", async () => {
    const claude = fakeClaude()
    const { app, records } = appWith(claude.run)
    const r = await post(app, "install", "plain@test-market")
    expect(r.statusCode).toBe(200)
    expect(records[0]).toMatchObject({
      event: "plugin_installed",
      input: { plugin: "plain@test-market", contents: { commands: 1, skills: 1 } },
    })
    const install = claude.calls.find((c) => c[1] === "install")!
    expect(install).toEqual(["plugin", "install", "plain@test-market", "--scope", "user", "--json"])
    expect(claude.calls.flat()).not.toContain("-y")
    expect(claude.calls.flat().some((a) => a.startsWith("--accept"))).toBe(false)
    const removed = await post(app, "uninstall", "plain@test-market")
    expect(removed.statusCode).toBe(200)
    expect(records[1]).toMatchObject({ event: "plugin_removed" })
    await app.close()
  })

  it("refuses a plugin with hooks or outside servers before anything runs, and records the refusal", async () => {
    for (const id of ["hooky@test-market", "servers@test-market", "remote@test-market"]) {
      const claude = fakeClaude()
      const { app, records } = appWith(claude.run)
      const r = await post(app, "install", id)
      expect(r.statusCode, id).toBe(403)
      expect(
        claude.calls.some((c) => c[1] === "install"),
        id,
      ).toBe(false)
      expect(records[0]).toMatchObject({ event: "plugin_refused", verdict: { outcome: "deny" } })
      await app.close()
    }
  })

  it("installs nothing it could not record", async () => {
    const claude = fakeClaude()
    const { app } = appWith(claude.run, false)
    expect((await post(app, "install", "plain@test-market")).statusCode).toBe(503)
    expect(claude.calls.some((c) => c[1] === "install")).toBe(false)
    await app.close()
  })

  it("removes it again when the installed copy holds what was refused", async () => {
    const changed = path.join(dir, "installed-copy")
    w(path.join(changed, "hooks", "hooks.json"), '{"hooks":{"PreToolUse":[]}}')
    const claude = fakeClaude({ installPath: changed })
    const { app, records } = appWith(claude.run)
    const r = await post(app, "install", "plain@test-market")
    expect(r.statusCode).toBe(403)
    expect((r.json() as { error: string }).error).toMatch(/removed again after installing: .*hooks/)
    expect(claude.calls.some((c) => c[1] === "uninstall" && c[2] === "plain@test-market")).toBe(
      true,
    )
    expect(records.at(-1)).toMatchObject({ event: "plugin_refused" })
    await app.close()
  })

  it("says so when Claude Code wants a command confirmed, and does not confirm it", async () => {
    const claude = fakeClaude({
      installOut: { outcome: "needs-confirmation", shownCommand: { sha256: "ab" } },
    })
    const { app } = appWith(claude.run)
    const r = await post(app, "install", "plain@test-market")
    expect(r.statusCode).toBe(502)
    expect((r.json() as { error: string }).error).toMatch(/would run a command/)
    await app.close()
  })
})

const binary = findClaudeBinary()
describe.skipIf(!binary)("with the real Claude Code, in a throwaway config folder", () => {
  it("installs a plugin it allows and removes it, and refuses one with a hook", async () => {
    const config = path.join(dir, "config")
    const run = binaryRunner(
      () => binary,
      () => ({ ...process.env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: undefined }),
    )
    const added = await run(["plugin", "marketplace", "add", market, "--json"])
    expect(added.code, added.stderr).toBe(0)
    const m = new Marketplace(run)
    const { plugins } = await m.catalogue()
    expect(plugins.find((p) => p.name === "plain")?.refusal).toBeUndefined()
    expect((await m.install("plain@test-market")).message).toMatch(/installed/i)
    expect((await m.catalogue()).plugins.find((p) => p.name === "plain")?.installed).toBeTruthy()
    await expect(m.install("hooky@test-market")).rejects.toThrow(/hooks/)
    expect((await m.uninstall("plain@test-market")).message).toMatch(/uninstalled/i)
  }, 180_000)
})
