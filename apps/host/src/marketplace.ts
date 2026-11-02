import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { sanitiseEnv } from "@gatehouse/shared"
import type { HostAudit } from "./hostaudit.js"

/**
 * The marketplace (W1-19, owner's backlog O1): browse the plugins of the marketplaces Claude Code knows, see what each
 * holds, and install one through the unmodified Claude Code binary, each install and removal in the audit log.
 *
 * A plugin is third-party code. Codehouse installs only what it can read before installing, and refuses a plugin with:
 * - hooks of any kind: a hook runs a command outside the Approver, and a PreToolUse or PermissionRequest hook could
 *   answer for it (owner's decision O14, 1 Nov, refuses plugins with permission hooks; every hook is refused here,
 *   which is stricter);
 * - MCP or LSP servers: they run as programs outside the session's process, which hard constraint 3 refuses;
 * - other plugins it brings with it, which Codehouse has not read;
 * - files that are not in a marketplace on this computer (a GitHub or web source), since what they hold cannot be
 *   read first.
 * An install that would run a command the marketplace declares is never confirmed (no -y). After installing, the
 * installed copy is read again, and removed if it holds anything refused.
 */

export interface Contents {
  commands: number
  agents: number
  skills: number
  hooks: boolean
  /** A hooks module (a mod): its tool.check hook could let a call run without the Approver. */
  mods: boolean
  mcpServers: boolean
  lspServers: boolean
  dependencies: number
}

export interface CatalogueEntry {
  id: string
  name: string
  marketplace: string
  description?: string
  version?: string
  category?: string
  /** What it holds, or undefined when its files are elsewhere and cannot be read first. */
  contents?: Contents
  /** Why Codehouse will not install it, in words; absent when it may be installed. */
  refusal?: string
  installed?: { version?: string; enabled: boolean }
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}
export type Runner = (args: string[]) => Promise<RunResult>

type Raw = Record<string, unknown>
const obj = (v: unknown): Raw => (typeof v === "object" && v !== null ? (v as Raw) : {})
const str = (v: unknown) => (typeof v === "string" ? v : undefined)

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown
  } catch {
    return undefined
  }
}

const count = (dir: string, test: (d: fs.Dirent) => boolean) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(test).length
  } catch {
    return 0
  }
}
const isMd = (d: fs.Dirent) => d.isFile() && d.name.toLowerCase().endsWith(".md")

/** A path inside a folder, or undefined for one that leaves it. */
function inside(root: string, rel: string): string | undefined {
  const full = path.resolve(root, rel)
  const r = path.relative(root, full)
  return r.startsWith("..") || path.isAbsolute(r) ? undefined : full
}

const present = (v: unknown) =>
  v !== undefined &&
  v !== null &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0)

/**
 * What a plugin's folder holds: its manifest, the folders Claude Code reads by default, and anything the marketplace
 * entry declares for it.
 */
export function inspectPlugin(dir: string, entry: Raw = {}): Contents {
  const manifest = obj(readJson(path.join(dir, ".claude-plugin", "plugin.json")))
  const skillsDir = path.join(dir, "skills")
  const hooksFile = fs.existsSync(path.join(dir, "hooks", "hooks.json"))
  const deps = [manifest.dependencies, entry.dependencies].flatMap((d) =>
    Array.isArray(d) ? d : d && typeof d === "object" ? Object.keys(d) : [],
  )
  return {
    commands: count(path.join(dir, "commands"), isMd),
    agents: count(path.join(dir, "agents"), isMd),
    skills: count(
      skillsDir,
      (d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")),
    ),
    hooks: hooksFile || present(manifest.hooks) || present(entry.hooks),
    mods: hasMod(dir, entry),
    mcpServers:
      fs.existsSync(path.join(dir, ".mcp.json")) ||
      present(manifest.mcpServers) ||
      present(entry.mcpServers),
    lspServers:
      fs.existsSync(path.join(dir, ".lsp.json")) ||
      present(manifest.lspServers) ||
      present(entry.lspServers),
    dependencies: deps.length,
  }
}

/**
 * Whether a plugin's folder holds a mod: a hooks module that hooks/hooks.json, or a hooks file or entry the manifest
 * names, lists under "modules" (Claude Code 2.1.310's plugin format). A mod's tool.check hook has the last word on
 * whether a tool call runs, after Codehouse's floor hook, so it could allow a call the Approver never saw (invariant
 * 2). A hooks file that is named but cannot be read counts as a mod: fail closed.
 */
export function hasMod(dir: string, entry: Raw = {}): boolean {
  const manifest = obj(readJson(path.join(dir, ".claude-plugin", "plugin.json")))
  const files: string[] = [path.join(dir, "hooks", "hooks.json")]
  const named: unknown[] = []
  for (const h of [manifest.hooks, entry.hooks])
    for (const one of Array.isArray(h) ? h : h === undefined || h === null ? [] : [h]) {
      if (typeof one !== "string") {
        named.push(one)
        continue
      }
      const file = inside(dir, one)
      // A hooks file outside the plugin cannot be read for what it holds.
      if (!file) return true
      files.push(file)
    }
  const modules = (v: unknown) => present(obj(v).modules)
  if (named.some(modules)) return true
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const j = readJson(file)
    if (j === undefined || modules(j)) return true
  }
  return false
}

/**
 * Of the plugins a session reports it loaded (its start message's `plugins`), the names of those with a mod. The
 * names are the plugins' own, so only plain characters are kept for showing them.
 */
export function pluginsWithMods(plugins: unknown): string[] {
  if (!Array.isArray(plugins)) return []
  return plugins
    .map((p) => obj(p))
    .filter((p) => typeof p.path === "string" && hasMod(p.path))
    .map((p) => (str(p.name) ?? "A plugin").replace(/[^\w@.\- ]/g, "").slice(0, 80) || "A plugin")
}

/** Why a plugin with these contents is refused, or undefined when it may be installed. */
export function refusalFor(c: Contents | undefined): string | undefined {
  if (!c)
    return "Its files are not in a marketplace on this computer (they are on GitHub or the web), so Codehouse cannot read what it holds before installing it."
  const why: string[] = []
  if (c.mods) why.push("a mod, which could let tool calls run without the Approver")
  else if (c.hooks) why.push("hooks, which run commands outside the Approver")
  if (c.mcpServers) why.push("MCP servers that run outside the session")
  if (c.lspServers) why.push("language servers that run as separate programs")
  if (c.dependencies) why.push("other plugins it installs with it")
  return why.length ? `It has ${why.join(", ")}.` : undefined
}

/** The default runner: the unmodified Claude Code binary, with no credential in its environment (invariant 6). */
export function binaryRunner(
  binary: () => string | undefined,
  env: () => Record<string, string | undefined> = () => sanitiseEnv(process.env),
  timeoutMs = 120_000,
): Runner {
  return (args) =>
    new Promise((resolve) => {
      const exe = binary()
      if (!exe)
        return resolve({ code: null, stdout: "", stderr: "The Claude Code program was not found." })
      const child = spawn(exe, args, {
        env: env(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
      const timer = setTimeout(() => child.kill(), timeoutMs)
      child.on("error", (e) => {
        clearTimeout(timer)
        resolve({ code: null, stdout, stderr: e.message })
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr })
      })
    })
}

const parse = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown
  } catch {
    // --json prints one result line last; anything before it is not ours
    const last = s.trim().split(/\r?\n/).at(-1) ?? ""
    try {
      return JSON.parse(last) as unknown
    } catch {
      return undefined
    }
  }
}

export class MarketplaceError extends Error {
  constructor(
    readonly code: "refused" | "failed" | "missing" | "busy",
    message: string,
  ) {
    super(message)
  }
}

export class Marketplace {
  readonly #run: Runner
  #busy = false

  constructor(run: Runner) {
    this.#run = run
  }

  async #marketplaces(): Promise<Array<{ name: string; location?: string }>> {
    const r = await this.#run(["plugin", "marketplace", "list", "--json"])
    const list = parse(r.stdout)
    if (r.code !== 0 || !Array.isArray(list))
      throw new MarketplaceError("failed", "Claude Code did not list its marketplaces.")
    return list
      .map((m) => obj(m))
      .filter((m) => typeof m.name === "string")
      .map((m) => ({
        name: m.name as string,
        ...(str(m.installLocation) ? { location: str(m.installLocation) } : {}),
      }))
  }

  async #installed(): Promise<
    Map<string, { version?: string; enabled: boolean; installPath?: string }>
  > {
    const r = await this.#run(["plugin", "list", "--json"])
    const list = parse(r.stdout)
    if (r.code !== 0 || !Array.isArray(list))
      throw new MarketplaceError("failed", "Claude Code did not list the installed plugins.")
    const out = new Map<string, { version?: string; enabled: boolean; installPath?: string }>()
    for (const raw of list) {
      const p = obj(raw)
      const id = str(p.id)
      if (!id) continue
      out.set(id, {
        ...(str(p.version) ? { version: str(p.version) } : {}),
        enabled: p.enabled !== false,
        ...(str(p.installPath) ? { installPath: str(p.installPath) } : {}),
      })
    }
    return out
  }

  /** Every plugin of every marketplace on this computer, with what it holds and whether Codehouse will install it. */
  async catalogue(): Promise<{ marketplaces: string[]; plugins: CatalogueEntry[] }> {
    const [markets, installed] = await Promise.all([this.#marketplaces(), this.#installed()])
    const plugins: CatalogueEntry[] = []
    for (const m of markets) {
      if (!m.location) continue
      const listed = obj(readJson(path.join(m.location, ".claude-plugin", "marketplace.json")))
      if (!Array.isArray(listed.plugins)) continue
      for (const raw of listed.plugins) {
        const e = obj(raw)
        const name = str(e.name)
        if (!name) continue
        const id = `${name}@${m.name}`
        const source = str(e.source)
        const dir = source && /^\.{1,2}[\\/]/.test(source) ? inside(m.location, source) : undefined
        const contents = dir && fs.existsSync(dir) ? inspectPlugin(dir, e) : undefined
        const refusal = refusalFor(contents)
        const have = installed.get(id)
        plugins.push({
          id,
          name,
          marketplace: m.name,
          ...(str(e.description) ? { description: str(e.description) } : {}),
          ...(str(e.version) ? { version: str(e.version) } : {}),
          ...(str(e.category) ? { category: str(e.category) } : {}),
          ...(contents ? { contents } : {}),
          ...(refusal ? { refusal } : {}),
          ...(have
            ? {
                installed: {
                  ...(have.version ? { version: have.version } : {}),
                  enabled: have.enabled,
                },
              }
            : {}),
        })
      }
    }
    return { marketplaces: markets.map((m) => m.name), plugins }
  }

  async #one<T>(work: () => Promise<T>): Promise<T> {
    if (this.#busy)
      throw new MarketplaceError("busy", "Another install or removal is still running.")
    this.#busy = true
    try {
      return await work()
    } finally {
      this.#busy = false
    }
  }

  /** The catalogue entry for an id, or an error saying it is not there. */
  async entry(id: string): Promise<CatalogueEntry> {
    const e = (await this.catalogue()).plugins.find((p) => p.id === id)
    if (!e)
      throw new MarketplaceError("missing", "That plugin is not in a marketplace on this computer.")
    return e
  }

  /**
   * Installs a plugin Codehouse has read and allows, through Claude Code, never confirming a command the marketplace
   * declares. The installed copy is read again; one that holds anything refused is removed at once.
   */
  async install(id: string): Promise<{ message: string }> {
    return this.#one(async () => {
      const e = await this.entry(id)
      if (e.refusal) throw new MarketplaceError("refused", e.refusal)
      const r = await this.#run(["plugin", "install", id, "--scope", "user", "--json"])
      const out = obj(parse(r.stdout))
      if (r.code !== 0 || out.outcome !== "ok")
        throw new MarketplaceError(
          "failed",
          str(out.message) ??
            (out.shownCommand
              ? "Installing it would run a command its marketplace declares, so Codehouse did not install it."
              : (r.stderr.trim().split(/\r?\n/).at(-1) ?? "Claude Code did not install it.")),
        )
      const have = (await this.#installed()).get(id)
      const after =
        have?.installPath && fs.existsSync(have.installPath)
          ? inspectPlugin(have.installPath)
          : undefined
      const late = refusalFor(after)
      if (late) {
        await this.#run(["plugin", "uninstall", id, "--scope", "user", "--json"])
        throw new MarketplaceError("refused", `It was removed again after installing: ${late}`)
      }
      return { message: str(out.message) ?? `Installed ${id}.` }
    })
  }

  async uninstall(id: string): Promise<{ message: string }> {
    return this.#one(async () => {
      const r = await this.#run(["plugin", "uninstall", id, "--scope", "user", "--json"])
      const out = obj(parse(r.stdout))
      if (r.code !== 0 || out.outcome !== "ok")
        throw new MarketplaceError("failed", str(out.message) ?? "Claude Code did not remove it.")
      return { message: str(out.message) ?? `Removed ${id}.` }
    })
  }
}

export function registerMarketplaceRoutes(
  app: FastifyInstance,
  ctx: { marketplace?: Marketplace; audit: HostAudit },
): void {
  const market = () => {
    if (!ctx.marketplace)
      throw new MarketplaceError("missing", "The marketplace is not available here.")
    return ctx.marketplace
  }
  const status = (e: MarketplaceError) =>
    e.code === "missing" ? 404 : e.code === "busy" ? 409 : e.code === "refused" ? 403 : 502
  const record = (
    event: string,
    id: string,
    outcome: "allow" | "deny",
    reason: string,
    extra: Raw = {},
  ) =>
    ctx.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "marketplace",
      cwd: "",
      input: { plugin: id, ...extra },
      verdict: {
        outcome,
        ruleId: outcome === "allow" ? event.replace(/_/g, "-") : "marketplace-refused",
        reason,
        risk: 0,
        decidedBy: outcome === "allow" ? "human-desktop" : "rules",
        policyHash: "",
      },
      latencyMs: 0,
    })

  app.get("/api/marketplace", async (_req, reply) => {
    try {
      return await market().catalogue()
    } catch (e) {
      if (e instanceof MarketplaceError) return reply.code(status(e)).send({ error: e.message })
      throw e
    }
  })

  for (const action of ["install", "uninstall"] as const) {
    app.post(`/api/marketplace/${action}`, async (req, reply) => {
      const id = str(obj(req.body).id)
      if (!id || !/^[\w.-]+@[\w.-]+$/.test(id))
        return reply.code(400).send({ error: "Say which plugin, as name@marketplace." })
      try {
        if (action === "install") {
          // Refused before anything runs, and the refusal recorded; an install is recorded before it runs.
          const e = await market().entry(id)
          if (e.refusal) {
            await record("plugin_refused", id, "deny", e.refusal).catch(() => false)
            return reply.code(403).send({ error: e.refusal })
          }
          const ok = await record(
            "plugin_installed",
            id,
            "allow",
            "A plugin was installed from the desktop.",
            {
              ...(e.version ? { version: e.version } : {}),
              contents: e.contents,
            },
          )
          if (!ok)
            return reply
              .code(503)
              .send({ error: "It could not be recorded, so it was not installed." })
          return await market().install(id)
        }
        const ok = await record(
          "plugin_removed",
          id,
          "allow",
          "A plugin was removed from the desktop.",
        )
        if (!ok)
          return reply.code(503).send({ error: "It could not be recorded, so it was not removed." })
        return await market().uninstall(id)
      } catch (e) {
        if (e instanceof MarketplaceError) {
          if (e.code === "refused")
            await record("plugin_refused", id, "deny", e.message).catch(() => false)
          return reply.code(status(e)).send({ error: e.message })
        }
        throw e
      }
    })
  }
}
