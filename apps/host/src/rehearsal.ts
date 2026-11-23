/**
 * E-098, the upgrade rehearsal, as the version you have runs it. Before switching to a downloaded release, it is started
 * against a synthetic data folder: copies of your settings and policy files only (the settings file, your remembered
 * and own rules and their limits, project overlays, shared rule packs), plus one sample open session written in this
 * version's format, and never your audit log, sessions, transcripts or secrets. The new version reads the settings,
 * loads the policy, runs its canaries and plans a session restore. When any step fails, you stay on this version and
 * are told why, with the choice to switch anyway. The synthetic folder is deleted afterwards, and the real data folder
 * is not touched. A release from before rehearsals is not held back for not having one.
 */
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OpenSessionsStore } from "./open-sessions.js"

export interface RealPaths {
  configFile: string
  localRules: string
  userRules: string
  overlayDir: string
  packsDir: string
}

export interface RehearsalResult {
  state: "passed" | "failed" | "skipped"
  why: string
  steps: Array<{ name: string; ok: boolean; detail: string }>
}

const SAMPLE_ID = "00000000-0000-4000-8000-00000000e098"

/** Makes the synthetic data folder: copies of settings and policy only, and one sample open session. */
export async function syntheticDataDir(real: RealPaths, root = os.tmpdir()): Promise<{ dir: string; env: Record<string, string> }> {
  const dir = path.join(root, `codeh-rehearsal-${crypto.randomBytes(4).toString("hex")}`)
  fs.mkdirSync(dir, { recursive: true })
  const copy = (from: string, to: string) => {
    try {
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, to)
    } catch {
      /* not there: nothing to copy */
    }
  }
  copy(real.configFile, path.join(dir, "config.json"))
  copy(real.localRules, path.join(dir, "rules.local.yaml"))
  copy(path.join(path.dirname(real.localRules), "rules.local.meta.json"), path.join(dir, "rules.local.meta.json"))
  copy(real.userRules, path.join(dir, "rules.user.yaml"))
  for (const [from, to, keep] of [
    [real.overlayDir, "projects", /\.ya?ml$/i],
    [real.packsDir, "rule-packs", /\.(ya?ml|sig)$/i],
  ] as const) {
    fs.mkdirSync(path.join(dir, to), { recursive: true })
    let names: string[] = []
    try {
      names = fs.readdirSync(from)
    } catch {
      names = []
    }
    for (const n of names) if (keep.test(n)) copy(path.join(from, n), path.join(dir, to, n))
  }
  // One sample open session, in this version's own format, for the new version to read back.
  const store = new OpenSessionsStore(path.join(dir, "open-sessions.json"))
  store.note({ id: SAMPLE_ID, cwd: dir, mode: "default", state: "idle", createdAt: new Date().toISOString(), paused: false } as never)
  await store.flush()
  return {
    dir,
    env: {
      GATEHOUSE_DATA_DIR: dir,
      GATEHOUSE_CONFIG: path.join(dir, "config.json"),
      GATEHOUSE_LOCAL_RULES: path.join(dir, "rules.local.yaml"),
      GATEHOUSE_USER_RULES: path.join(dir, "rules.user.yaml"),
      GATEHOUSE_OVERLAY_DIR: path.join(dir, "projects"),
      GATEHOUSE_REHEARSE: "1",
    },
  }
}

/** Where a staged release keeps its Node and its Host, Windows or Mac. */
export function stagedEntry(staged: string): { node: string; main: string } | undefined {
  const main = [path.join(staged, "app", "apps", "host", "dist", "main.mjs"), path.join(staged, "Contents", "Resources", "app", "apps", "host", "dist", "main.mjs")].find((p) => fs.existsSync(p))
  const node = [path.join(staged, "runtime", "node.exe"), path.join(staged, "Contents", "Resources", "runtime", "node")].find((p) => fs.existsSync(p))
  return main && node ? { node, main } : undefined
}

export type Runner = (node: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ stdout: string; code: number | null }>

const runFor: Runner = (node, args, env, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(node, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
    let stdout = ""
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ stdout, code })
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ stdout, code: null })
    })
  })

/** Rehearses the staged release; deletes the synthetic folder whatever happens. */
export async function rehearse(staged: string, real: RealPaths, o: { run?: Runner; timeoutMs?: number; tmpRoot?: string } = {}): Promise<RehearsalResult> {
  const entry = stagedEntry(staged)
  if (!entry) return { state: "skipped", why: "the new version's files could not be found to rehearse it", steps: [] }
  const syn = await syntheticDataDir(real, o.tmpRoot)
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, ...syn.env }
    // Never a credential (invariant 6), and never the running Host's own token or port.
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "GATEHOUSE_HOST_PORT", "GATEHOUSE_TOKEN"]) delete env[k]
    const { stdout, code } = await (o.run ?? runFor)(entry.node, [entry.main], env, o.timeoutMs ?? 90_000)
    const line = stdout.split(/\r?\n/).reverse().find((l) => l.includes('"codehouseRehearsal"'))
    let report: { ok?: boolean; steps?: RehearsalResult["steps"] } | undefined
    try {
      report = line ? (JSON.parse(line) as typeof report) : undefined
    } catch {
      report = undefined
    }
    if (!report) return { state: "failed", why: code === null ? "the new version did not finish its rehearsal in time" : "the new version did not report a rehearsal", steps: [] }
    const steps = report.steps ?? []
    const bad = steps.filter((s) => !s.ok)
    return report.ok && !bad.length ? { state: "passed", why: "the new version read your settings, loaded your policy, passed its canaries and could restore your sessions", steps } : { state: "failed", why: bad.map((s) => `${s.name}: ${s.detail}`).join("; ") || "the rehearsal failed", steps }
  } finally {
    fs.rmSync(syn.dir, { recursive: true, force: true })
  }
}
