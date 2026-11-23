/**
 * E-098, the upgrade rehearsal, as the new version runs it. Started by the version you have, with GATEHOUSE_REHEARSE=1
 * and its data folder pointing at a synthetic copy (settings and policy only, and one sample open session the
 * current version wrote in its own format). It starts nothing: no Approver, no server, no session. It reads the
 * settings, loads the policy, runs the invariant canaries (E-100) and plans the sample session's restore, then prints
 * one line of JSON with each step and exits.
 */
import path from "node:path"
import { loadPolicy } from "@gatehouse/policy"
import { gatehouseDataDir, loadConfig } from "@gatehouse/shared/node"
import { REPO_ROOT } from "./bootstrap.js"
import { runCanaries } from "./canaries.js"
import { OpenSessionsStore, restoreOpenSessions } from "./open-sessions.js"

export const REHEARSAL_MARK = "codehouseRehearsal"

export interface RehearsalStep {
  name: "settings" | "policy" | "canaries" | "restore"
  ok: boolean
  detail: string
}

export async function runRehearsal(env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; steps: RehearsalStep[] }> {
  const steps: RehearsalStep[] = []
  const step = async (name: RehearsalStep["name"], f: () => Promise<string> | string) => {
    try {
      steps.push({ name, ok: true, detail: await f() })
      return true
    } catch (e) {
      steps.push({ name, ok: false, detail: (e as Error).message.split("\n").slice(0, 3).join(" ").slice(0, 400) })
      return false
    }
  }
  const data = gatehouseDataDir(env)
  let config: ReturnType<typeof loadConfig> | undefined
  await step("settings", () => {
    config = loadConfig(env)
    return "your settings read"
  })
  const rulesPath = env.GATEHOUSE_RULES_PATH ?? config?.rulesPath ?? path.join(REPO_ROOT, "policy", "rules.yaml")
  const rulesDir = path.dirname(rulesPath)
  let policy: ReturnType<typeof loadPolicy> | undefined
  await step("policy", () => {
    policy = loadPolicy({
      rulesPath,
      localPath: env.GATEHOUSE_LOCAL_RULES ?? path.join(rulesDir, "rules.local.yaml"),
      userRulesPath: env.GATEHOUSE_USER_RULES ?? path.join(rulesDir, "rules.user.yaml"),
      overlayDir: env.GATEHOUSE_OVERLAY_DIR ?? path.join(rulesDir, "projects"),
      libraryDir: path.join(REPO_ROOT, "policy", "library"),
      sharedPacksDir: path.join(data, "rule-packs"),
      trustedPackKeys: config?.rulePackKeys ?? [],
    })
    return `the policy loaded (${policy.hash.slice(0, 12)})`
  })
  if (policy) {
    const p = policy
    await step("canaries", async () => {
      const run = await runCanaries({ policy: () => p, rulesPath, psVerifier: path.join(REPO_ROOT, "scripts", "verify-audit.ps1") })
      const failing = run.results.filter((r) => !r.ok)
      if (failing.length) throw new Error(`canaries failed: ${failing.map((r) => `${r.id} (${r.detail ?? ""})`).join("; ")}`)
      return `${run.results.length} canaries passed`
    })
  } else steps.push({ name: "canaries", ok: false, detail: "not run: the policy did not load" })
  await step("restore", async () => {
    const store = new OpenSessionsStore(path.join(data, "open-sessions.json"))
    const planned: string[] = []
    // Nothing is started: the restore is planned, and what it would start is counted.
    const n = await restoreOpenSessions(store, {
      start: async (o) => {
        if (o.restore?.id) planned.push(o.restore.id)
      },
      killed: () => false,
      audit: async () => undefined,
      log: () => undefined,
    })
    if (!n || !planned.length) throw new Error("the open sessions the current version saved could not be read for a restore")
    return `${planned.length} open session(s) would come back`
  })
  return { ok: steps.every((s) => s.ok), steps }
}

/** For main.ts: run it, print the one line, and give the exit code. */
export async function rehearseAndReport(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const r = await runRehearsal(env).catch((e: Error) => ({ ok: false, steps: [{ name: "settings" as const, ok: false, detail: `the rehearsal stopped: ${e.message}` }] }))
  process.stdout.write(JSON.stringify({ [REHEARSAL_MARK]: 1, ...r }) + "\n")
  return r.ok ? 0 : 1
}
