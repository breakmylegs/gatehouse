import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { GatehouseConfig } from "@gatehouse/shared/node"
import { judgeClaim, judgeRuntime, type JudgeResult } from "./claim-judge.js"
import { withoutCredentials } from "./codehouse-action.js"
import type { LocalRuntimeConfig } from "./providers/local-runtime.js"
import { FOUNDRY_PROFILE, foundryNpuModels } from "./providers/foundry-local.js"

/**
 * D-098: on Foundry Local, a model that runs on the NPU (downloaded, and on your list of models) judges in place of the
 * one chosen, leaving the CPU and graphics card to the work; with none, the chosen one judges and the result says so.
 */
export async function judgeModel(local: LocalRuntimeConfig | undefined, chosen: string | undefined, fetchFn?: typeof fetch): Promise<{ model?: string; ranOn?: string }> {
  if (!chosen) return {}
  if (!local || local.kind !== "openai-compatible" || local.profile !== FOUNDRY_PROFILE) return { model: chosen }
  const listed = new Set(local.models.map((m) => m.name))
  const npu = (await foundryNpuModels(local.url, fetchFn)).find((m) => listed.has(m))
  return npu
    ? { model: npu, ranOn: `the NPU, with ${npu}` }
    : { model: chosen, ranOn: `no model on your list runs on the NPU in Foundry Local, so ${chosen} judged it` }
}

/** D-086: the claims judge for a session's folder: its uncommitted change against HEAD, and its tests' assertions. */
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/i

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: withoutCredentials(process.env) }, (e, out) => (e ? reject(e) : resolve(String(out)))),
  )
}

/** The test files' text, at most 300 files and 2 MB in all. */
async function testTexts(cwd: string): Promise<string[]> {
  const listed = (await git(cwd, ["ls-files", "-co", "--exclude-standard"]).catch(() => "")).split(/\r?\n/).filter((f) => TEST_FILE.test(f) && !f.includes("node_modules/"))
  const out: string[] = []
  let room = 2 * 1024 * 1024
  for (const f of listed.slice(0, 300))
    try {
      const text = fs.readFileSync(path.join(cwd, f), "utf8")
      if (text.length > room) break
      room -= text.length
      out.push(text)
    } catch {
      // gone since
    }
  return out
}

export function makeClaimJudge(d: { config: () => GatehouseConfig; redact: (s: string) => string; fetchFn?: typeof fetch }) {
  return async (o: { cwd: string; claim: string }): Promise<JudgeResult> => {
    const p = d.config().providers
    const local = p?.local as LocalRuntimeConfig | undefined
    const pick = await judgeModel(local, p?.claimJudge?.model, d.fetchFn)
    const cfg = judgeRuntime(local, pick.model)
    const diff = await git(o.cwd, ["diff", "HEAD", "--no-color", "--no-ext-diff"]).catch(() => "")
    const result = await judgeClaim({
      claim: o.claim,
      diff,
      testTexts: await testTexts(o.cwd),
      ...(cfg && pick.model ? { runtime: { cfg, model: pick.model } } : {}),
      redact: d.redact,
      ...(d.fetchFn ? { fetchFn: d.fetchFn } : {}),
    })
    return cfg && pick.ranOn ? { ...result, ranOn: pick.ranOn } : result
  }
}
