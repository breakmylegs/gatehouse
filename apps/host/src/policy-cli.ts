/**
 * T-067: `npm run policy -- check` and `npm run policy -- show`, for IT and for you. check loads the rules with IT's
 * signed policy from this computer's managed folder (or --managed-dir) exactly as the Host would, and says whether it
 * is good; it exits 1 when it is not, so a script can stop on it. show lists what the policy's managed settings allow,
 * in words. Read only: nothing is changed and nothing is sent anywhere.
 */
import path from "node:path"
import { parseArgs } from "node:util"
import { describeManaged, loadPolicy, MANAGED_ERROR, PolicyLoadError, type Policy } from "@gatehouse/policy"
import { managedPolicyDir } from "@gatehouse/shared/node"

export interface PolicyReport {
  ok: boolean
  managedDir: string
  managed: boolean
  errors: string[]
  lines: string[]
}

/** The report for one look, given where the rules and IT's folder are. */
export function policyReport(rulesPath: string, managedDir: string): PolicyReport {
  let policy: Policy | undefined
  let errors: string[] = []
  try {
    policy = loadPolicy({ rulesPath, managedDir })
  } catch (e) {
    errors = e instanceof PolicyLoadError ? e.errors : [(e as Error).message]
  }
  return {
    // Any error stops the Host's sessions too; IT's own are the ones that start "managed policy".
    ok: errors.length === 0,
    managedDir,
    managed: policy?.managed === true,
    errors: [...errors.filter((e) => e.startsWith(MANAGED_ERROR)), ...errors.filter((e) => !e.startsWith(MANAGED_ERROR))],
    lines: policy ? describeManaged(policy.managedSettings) : [],
  }
}

/** The report in words, as the command prints it. */
export function reportText(r: PolicyReport, what: "check" | "show"): string {
  const out: string[] = []
  if (what === "check") {
    out.push(r.ok ? (r.managed ? `IT's policy in ${r.managedDir} is signed, checked and in force.` : `There is no policy from IT in ${r.managedDir}.`) : `IT's policy in ${r.managedDir} cannot be used, so no session will start:`)
    for (const e of r.errors) out.push(`  ${e}`)
  } else out.push(...r.lines)
  return out.join("\n")
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\\/g, "/").endsWith("/policy-cli.ts")
if (isMain) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "managed-dir": { type: "string" }, rules: { type: "string" }, json: { type: "boolean", default: false } } })
  const what = positionals[0]
  if (what !== "check" && what !== "show") {
    console.error("Usage: npm run policy -- check|show [--managed-dir <folder>] [--rules <rules.yaml>] [--json]")
    process.exit(2)
  }
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..")
  const report = policyReport(values.rules ?? path.join(root, "policy", "rules.yaml"), values["managed-dir"] ?? managedPolicyDir())
  console.log(values.json ? JSON.stringify(report, null, 2) : reportText(report, what))
  process.exit(what === "check" && !report.ok ? 1 : 0)
}
