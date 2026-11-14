// D-057, the offline vulnerability snapshot: with a signed test snapshot a known vulnerable version escalates the
// commit with its advisory id, even in Extreme approval; an unsigned or tampered snapshot is refused, nothing is matched
// against it (fail closed), and Doctor says so.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { doctorChecks } from "../src/doctor.js"
import { compareVersions, VULN_RULE, VulnCommitGuard, VulnSnapshot } from "../src/vuln-snapshot.js"
import type { DependencyChange } from "../src/sbom.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-osv-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const ADVISORIES = [
  {
    id: "GHSA-p6mc-m468-83gw",
    aliases: ["CVE-2020-8203"],
    affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.19" }] }] }],
  },
  { id: "PYSEC-2023-74", affected: [{ package: { ecosystem: "PyPI", name: "requests" }, versions: ["2.30.0"] }] },
]

function managed(name: string, o: { sign?: boolean; tamper?: boolean } = {}): string {
  const dir = path.join(root, name)
  fs.mkdirSync(dir)
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
  const data = Buffer.from(JSON.stringify(ADVISORIES))
  fs.writeFileSync(path.join(dir, "osv-snapshot.json"), data)
  fs.writeFileSync(path.join(dir, "osv-key.json"), JSON.stringify(publicKey.export({ format: "jwk" })))
  if (o.sign !== false)
    fs.writeFileSync(path.join(dir, "osv-snapshot.sig"), crypto.sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"))
  if (o.tamper) fs.writeFileSync(path.join(dir, "osv-snapshot.json"), data.toString().replace("4.17.19", "4.17.1"))
  return dir
}

const change = (name: string, version: string, ecosystem: DependencyChange["package"]["ecosystem"] = "npm"): DependencyChange => ({
  kind: "changed",
  lockfile: "package-lock.json",
  package: { ecosystem, name, version },
  previousVersion: "1.0.0",
})

describe("the offline vulnerability snapshot (D-057)", () => {
  it("names a known vulnerable version with its advisory, and leaves a fixed one alone", () => {
    const s = new VulnSnapshot(managed("ok"))
    expect(s.status()).toEqual({ state: "ok", advisories: 2 })
    expect(s.matches([change("lodash", "4.17.15"), change("lodash", "4.17.21"), change("requests", "2.30.0", "pypi")])).toEqual([
      { name: "lodash", version: "4.17.15", ecosystem: "npm", ids: ["GHSA-p6mc-m468-83gw"], lockfile: "package-lock.json" },
      { name: "requests", version: "2.30.0", ecosystem: "PyPI", ids: ["PYSEC-2023-74"], lockfile: "package-lock.json" },
    ])
    expect(compareVersions("4.17.9", "4.17.19")).toBeLessThan(0)
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBeLessThan(0)
  })

  it("refuses an unsigned or changed snapshot, matches nothing against it, and Doctor says so", () => {
    for (const [name, o, why] of [
      ["unsigned", { sign: false }, /no signature/],
      ["tampered", { tamper: true }, /does not verify/],
    ] as const) {
      const s = new VulnSnapshot(managed(name, o))
      const st = s.status()
      expect(st.state).toBe("refused")
      expect(st.state === "refused" && st.why).toMatch(why)
      expect(s.matches([change("lodash", "4.17.15")])).toEqual([])
      const health = {
        approver: { state: "up", errors: [] },
        relay: { state: "not-configured", devices: 0 },
        signin: { signedIn: true, organization: "ACN", managedPolicy: "detected", orgOk: true, checked: true },
        killSwitch: { engaged: false, approverConfirmed: true },
        pwsh: { running: true },
      }
      const doctor = doctorChecks({ health: health as never, claude: { found: true, version: "2.1.310" }, listener: { address: "127.0.0.1" }, vulnSnapshot: st })
      expect(doctor.find((c) => c.id === "vuln-snapshot")).toMatchObject({ state: "fail" })
    }
    // With no snapshot at all nothing changes, and Doctor has nothing to say about it.
    expect(new VulnSnapshot(path.join(root, "absent")).status()).toEqual({ state: "none" })
  })

  it("sends a commit that adds a vulnerable version to a person", async () => {
    const top = path.join(root, "repo")
    fs.mkdirSync(top)
    fs.writeFileSync(path.join(top, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/lodash": { version: "4.17.15" } } }))
    const run = vi.fn(async (_cwd: string, args: string[]) => {
      if (args.includes("--show-toplevel")) return top
      if (args.includes("diff")) return "--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1 +1 @@\n+x\n"
      if (args[0] === "show") return JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/lodash": { version: "4.17.21" } } })
      return ""
    })
    const vulns = new VulnCommitGuard(new VulnSnapshot(managed("commit")), run)
    expect((await vulns.matches(top, 'git commit -m "bump"')).map((m) => m.ids)).toEqual([["GHSA-p6mc-m468-83gw"]])
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const deps = {
      sessionId: "s1",
      cwd: top,
      project: "shop",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "git-local", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => false,
      notifyAutoApproved: () => undefined,
      log: () => undefined,
      vulns,
    } as unknown as CanUseDeps
    await createCanUseTool(deps)("Bash", { command: 'git commit -m "bump"' }, { toolUseID: "t1", signal: new AbortController().signal } as never)
    expect(request).toHaveBeenCalledTimes(1)
    const v = (request.mock.calls[0] as unknown as [{ verdict: { ruleId: string; reason: string } }])[0].verdict
    expect(v.ruleId).toBe(VULN_RULE)
    expect(v.reason).toContain("lodash 4.17.15 (GHSA-p6mc-m468-83gw)")
  })
})
