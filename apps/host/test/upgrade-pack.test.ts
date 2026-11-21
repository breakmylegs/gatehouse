// D-071: an upgrade's pack holds its tests, its SBOM delta and its admission checks, and says plainly what is missing.
import { describe, expect, it } from "vitest"
import type { EvidencePack } from "../src/evidence.js"
import type { DependencyChange } from "../src/sbom.js"
import { upgradePack, type AdmissionCheck } from "../src/upgrade-pack.js"

const change = (kind: DependencyChange["kind"], name: string, version: string, previousVersion?: string): DependencyChange => ({
  kind,
  lockfile: "package-lock.json",
  package: { ecosystem: "npm", name, version },
  ...(previousVersion ? { previousVersion } : {}),
})
const changes = [change("changed", "left-pad", "1.3.0", "1.1.0"), change("added", "tiny-dep", "2.0.0"), change("removed", "old-dep", "0.9.0")]
const evidence = (commands: Array<{ command: string; result: "succeeded" | "failed" | "not seen" }>) => ({ commands }) as unknown as EvidencePack
const sbom = { bomFormat: "CycloneDX" }

describe("the upgrade pack", () => {
  it("lists the upgrades, what was added and removed, the tests after the change, the SBOM delta and the checks", () => {
    const admission: AdmissionCheck[] = [{ dependency: "npm:left-pad", check: "licence", outcome: "escalate", reason: "WTFPL is not on the list" }]
    const p = upgradePack({ changes, evidence: evidence([{ command: "npm run build", result: "succeeded" }, { command: "npm test", result: "succeeded" }]), sbom, admission })
    expect(p).toMatchObject({
      upgrades: [{ ecosystem: "npm", name: "left-pad", from: "1.1.0", to: "1.3.0", lockfile: "package-lock.json" }],
      added: [{ name: "tiny-dep", version: "2.0.0" }],
      removed: [{ name: "old-dep", version: "0.9.0" }],
      tests: [{ command: "npm test", result: "succeeded" }],
      testsPassed: true,
      sbom,
      admission,
      complete: true,
      missing: [],
    })
  })

  it("is not complete without tests after the change, when the last run failed, or when a check refused a dependency", () => {
    expect(upgradePack({ changes, evidence: evidence([{ command: "npm run build", result: "succeeded" }]), sbom, admission: [] }).missing).toEqual(["no tests were run after the change"])
    expect(upgradePack({ changes, evidence: undefined, sbom, admission: [] }).missing).toEqual(["there is no evidence pack for the change, so its tests are not known"])
    const failed = upgradePack({ changes, evidence: evidence([{ command: "npx vitest run", result: "succeeded" }, { command: "npm test", result: "failed" }]), sbom, admission: [] })
    expect(failed).toMatchObject({ testsPassed: false, complete: false, missing: ["the last test run (npm test) did not pass"] })
    const refused = upgradePack({
      changes,
      evidence: evidence([{ command: "npm test", result: "succeeded" }]),
      sbom,
      admission: [{ dependency: "npm:reqeusts", check: "new name", outcome: "deny", reason: "an invented name" }],
    })
    expect(refused).toMatchObject({ complete: false, missing: ["1 admission check(s) refused a dependency"] })
  })
})
