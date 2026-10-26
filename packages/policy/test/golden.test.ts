import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { PolicyEngine } from "../src/engine.js"
import { loadPolicy, PolicyLoadError } from "../src/loader.js"
import { PwshWorker } from "../src/pwsh.js"
import { fwd, makeEngine, makeFixture, SEED_RULES, shortNameOf, type Fixture } from "./helpers.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = path.join(here, "golden")

type Needs = "junction" | "short" | "env8" | "progra"

interface Case {
  t?: string
  cmd?: string
  p?: string
  g?: string
  url?: string
  q?: string
  in?: Record<string, unknown>
  cwd?: string
  /** The SDK-reported source of an MCP server (`sdk`, `user`, ...). */
  src?: string
  o?: "allow" | "deny" | "escalate"
  r?: string
  needs?: Needs
  kind?: "overlay" | "remember"
  overlay?: unknown
  overlayName?: string
  remember?: unknown
  load?: "reject"
  err?: string
  note?: string
}

interface Loaded {
  category: string
  cases: Case[]
}

function loadCorpus(): Loaded[] {
  return fs
    .readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const cases = parseYaml(fs.readFileSync(path.join(GOLDEN_DIR, f), "utf8")) as Case[]
      return { category: f.replace(/\.yaml$/, ""), cases }
    })
}

const corpus = loadCorpus()

const fx: Fixture = makeFixture()
const pwsh = new PwshWorker()
let shared: ReturnType<typeof makeEngine>
let env8: string | undefined
let skipped = 0
let evaluated = 0

function subst(value: string): string {
  return value
    .replaceAll("${WSW}", fx.ws)
    .replaceAll("${WS}", fwd(fx.ws))
    .replaceAll("${OUTW}", fx.out)
    .replaceAll("${OUT}", fwd(fx.out))
    .replaceAll("${ROOT}", fwd(fx.root))
    .replaceAll("${LONG}", fx.longDir)
    .replaceAll("${SHORT}", fx.shortDir ?? "NOSHORT")
    .replaceAll("${ENV8}", env8 ?? "NOENV8")
}

function substDeep<T>(value: T): T {
  if (typeof value === "string") return subst(value) as T
  if (Array.isArray(value)) return value.map((v) => substDeep(v)) as T
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substDeep(v)])) as T
  }
  return value
}

function inputFor(c: Case): Record<string, unknown> {
  if (c.in) return substDeep(c.in)
  switch (c.t) {
    case "Bash":
    case "PowerShell":
      return { command: subst(c.cmd ?? "") }
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
      return { file_path: subst(c.p ?? "") }
    case "NotebookEdit":
      return { notebook_path: subst(c.p ?? "") }
    case "Grep":
      return { pattern: "x", ...(c.p !== undefined ? { path: subst(c.p) } : {}), ...(c.g !== undefined ? { glob: subst(c.g) } : {}) }
    case "Glob":
      return { pattern: subst(c.g ?? "*"), ...(c.p !== undefined ? { path: subst(c.p) } : {}) }
    case "WebFetch":
      return { url: subst(c.url ?? "") }
    case "WebSearch":
      return { query: c.q ?? "" }
    default:
      return {}
  }
}

function skipReason(c: Case): string | undefined {
  switch (c.needs) {
    case "junction":
      return fs.existsSync(path.join(fx.ws, "link")) ? undefined : "junction could not be created"
    case "short":
      return fx.shortDir ? undefined : "8.3 short names are disabled on this volume"
    case "env8":
      return env8 ? undefined : "no 8.3 alias for .env on this volume"
    case "progra":
      return fs.existsSync("C:/PROGRA~1") ? undefined : "8.3 alias PROGRA~1 is not available"
    default:
      return undefined
  }
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-golden-"))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function runCase(c: Case): Promise<{ outcome?: string; ruleId?: string; loadError?: string }> {
  const ctx = { cwd: c.cwd ? subst(c.cwd) : fwd(fx.ws), ...(c.src !== undefined ? { mcpSource: c.src } : {}) }
  const call = { toolName: c.t ?? "", input: inputFor(c) }
  if (c.kind === "overlay" || c.kind === "remember") {
    return withTempDir(async (dir) => {
      let overlayDir: string | undefined
      let localPath: string | undefined
      if (c.kind === "overlay") {
        overlayDir = path.join(dir, "overlays")
        fs.mkdirSync(overlayDir)
        fs.writeFileSync(path.join(overlayDir, `${c.overlayName ?? "ws"}.yaml`), stringifyYaml(substDeep(c.overlay)))
      } else {
        localPath = path.join(dir, "rules.local.yaml")
        fs.writeFileSync(localPath, stringifyYaml(substDeep(c.remember)))
      }
      try {
        const policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)], overlayDir, localPath })
        if (c.load === "reject") return { loadError: "loaded" }
        const engine = new PolicyEngine({ getPolicy: () => policy, pwsh })
        const v = await engine.evaluate(call, ctx)
        return { outcome: v.outcome, ruleId: v.ruleId }
      } catch (e) {
        if (e instanceof PolicyLoadError) return { loadError: e.message }
        throw e
      }
    })
  }
  const v = await shared.engine.evaluate(call, ctx)
  return { outcome: v.outcome, ruleId: v.ruleId }
}

beforeAll(async () => {
  await pwsh.start()
  shared = makeEngine(fx, pwsh)
  env8 = shortNameOf(path.join(fx.ws, ".env"))
}, 60000)

afterAll(() => {
  pwsh.close()
  fx.dispose()
})

const MIN_PER_CATEGORY: Record<string, number> = {
  "01-chaining-pipes": 25,
  "02-substitution": 20,
  "03-quoting": 25,
  "04-secrets": 45,
  "05-critical-paths": 12,
  "06-windows-paths": 30,
  "07-mcp-unknown": 18,
  "08-malformed": 8,
  "09-parse-failures": 12,
  "10-shell-flags": 18,
  "11-powershell": 45,
  "12-overlays": 14,
  "13-remember": 12,
}

for (const { category, cases } of corpus) {
  describe(`golden ${category}`, () => {
    cases.forEach((c, i) => {
      const label = c.cmd ?? c.p ?? c.g ?? c.url ?? c.q ?? c.note ?? JSON.stringify(c.in ?? c.overlay ?? c.remember ?? "")
      const name = `#${i + 1} ${c.t ?? c.kind ?? ""} ${String(label).replace(/\s+/g, " ").slice(0, 70)}`
      it(name, async () => {
        const reason = skipReason(c)
        if (reason) {
          skipped++
          console.warn(`SKIPPED golden ${category} #${i + 1}: ${reason}`)
          return
        }
        evaluated++
        const got = await runCase(c)
        if (c.load === "reject") {
          expect(got.loadError, "expected the policy to be rejected").toBeDefined()
          expect(got.loadError).not.toBe("loaded")
          if (c.err) expect(got.loadError).toContain(c.err)
          return
        }
        expect(got.loadError, "policy should load").toBeUndefined()
        expect({ outcome: got.outcome, ruleId: got.ruleId }).toEqual({ outcome: c.o, ruleId: c.r })
      })
    })
  })
}

describe("golden corpus floor (the suite must not pass by finding nothing)", () => {
  const all = corpus.flatMap((l) => l.cases)

  it("has at least 250 cases in total", () => {
    expect(all.length).toBeGreaterThanOrEqual(250)
  })

  it("has every category and at least its minimum number of cases", () => {
    const counts = new Map(corpus.map((l) => [l.category, l.cases.length]))
    for (const [cat, min] of Object.entries(MIN_PER_CATEGORY)) {
      expect(counts.get(cat) ?? 0, `category ${cat}`).toBeGreaterThanOrEqual(min)
    }
    for (const l of corpus) expect(MIN_PER_CATEGORY[l.category], `unknown category file ${l.category}`).toBeDefined()
  })

  it("covers all three outcomes, with at least 40 cases each", () => {
    for (const o of ["allow", "deny", "escalate"] as const) {
      expect(all.filter((c) => c.o === o).length, o).toBeGreaterThanOrEqual(40)
    }
  })

  it("expects every seed rule id and every built-in escalation at least once", () => {
    const wanted = [
      "secrets-files",
      "obfuscated-shell",
      "critical-paths",
      "outside-workspace-write",
      "destructive-shell",
      "package-install",
      "network",
      "git-remote",
      "mcp-external",
      "unc-path",
      "read-workspace",
      "edit-workspace-source",
      "safe-shell",
      "companion-tools",
      "parse-error",
      "malformed-input",
      "unknown-tool",
      "no-rule",
      "dynamic-segment",
      "bash-heredoc",
      "bash-eval",
      "shell-redirect-write",
      "pwsh-start-process",
      "pwsh-scriptblock-create",
      "pwsh-add-type",
      "pwsh-download-string",
      "pwsh-registry-write",
      "pwsh-execution-policy",
    ]
    const have = new Set(all.map((c) => c.r))
    for (const id of wanted) expect(have.has(id), `no golden expects ${id}`).toBe(true)
  })

  it("actually used the PowerShell worker and evaluated nearly everything", () => {
    expect(pwsh.running).toBe(true)
    expect(evaluated + skipped).toBeGreaterThanOrEqual(250)
    expect(skipped).toBeLessThanOrEqual(10)
  })
})
