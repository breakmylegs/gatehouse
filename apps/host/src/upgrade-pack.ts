/**
 * D-071, dependency upgrades with evidence (Frontier build). A change that upgrades dependencies gets one pack that holds
 * what an upgrade must be judged on: each upgrade (from and to), the tests run after it and how they ended (from the
 * change's evidence pack, D-003), the SBOM of what changed (D-056), and the admission checks: names the project did not
 * use (D-053), licences (D-055) and the vulnerability snapshot (D-057). It is complete only when tests ran after the
 * change and passed, and no check refused anything; what is missing is said plainly. Nothing runs or is fetched.
 */
import type { DependencyChange } from "./sbom.js"
import type { EvidencePack } from "./evidence.js"
import { TEST_COMMAND } from "./failure-taxonomy.js"

export interface AdmissionCheck {
  /** ecosystem:name */
  dependency: string
  check: "new name" | "licence" | "vulnerability"
  outcome: "deny" | "escalate"
  reason: string
}

export interface UpgradePack {
  upgrades: Array<{ ecosystem: string; name: string; from: string; to: string; lockfile: string }>
  added: Array<{ ecosystem: string; name: string; version: string }>
  removed: Array<{ ecosystem: string; name: string; version: string }>
  tests: Array<{ command: string; result: string }>
  testsPassed: boolean
  sbom: Record<string, unknown>
  admission: AdmissionCheck[]
  complete: boolean
  missing: string[]
}

export function upgradePack(o: { changes: DependencyChange[]; evidence: EvidencePack | undefined; sbom: Record<string, unknown>; admission: AdmissionCheck[] }): UpgradePack {
  const upgrades = o.changes
    .filter((c) => c.kind === "changed" && c.previousVersion !== undefined)
    .map((c) => ({ ecosystem: c.package.ecosystem, name: c.package.name, from: c.previousVersion!, to: c.package.version, lockfile: c.lockfile }))
  const pick = (kind: DependencyChange["kind"]) => o.changes.filter((c) => c.kind === kind).map((c) => ({ ecosystem: c.package.ecosystem, name: c.package.name, version: c.package.version }))
  const tests = (o.evidence?.commands ?? []).filter((c) => TEST_COMMAND.test(c.command)).map((c) => ({ command: c.command, result: c.result }))
  // The last test run is what the change leaves; one that failed or was not seen is not a pass.
  const testsPassed = tests.length > 0 && tests.at(-1)!.result === "succeeded"
  const missing: string[] = []
  if (!o.evidence) missing.push("there is no evidence pack for the change, so its tests are not known")
  else if (!tests.length) missing.push("no tests were run after the change")
  else if (!testsPassed) missing.push(`the last test run (${tests.at(-1)!.command}) did not pass`)
  const refused = o.admission.filter((a) => a.outcome === "deny")
  if (refused.length) missing.push(`${refused.length} admission check(s) refused a dependency`)
  return {
    upgrades,
    added: pick("added"),
    removed: pick("removed"),
    tests,
    testsPassed,
    sbom: o.sbom,
    admission: o.admission,
    complete: missing.length === 0,
    missing,
  }
}
