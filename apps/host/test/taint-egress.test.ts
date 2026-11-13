// D-016, the taint-tracked egress guard: the golden cases of values followed from untrusted sources into calls, and
// that it can only escalate, never allow, and that Extreme approval never approves it.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import type { Verdict } from "@gatehouse/shared"
import { NEVER_AUTO_APPROVED } from "../src/canuse.js"
import { EGRESS_RULE, FETCH_RULE, Provenance, valuesIn, withProvenance } from "../src/provenance.js"

const CWD = "C:/dev/proj"
const allow: Verdict = { outcome: "allow", ruleId: "network", reason: "ok", risk: 30, decidedBy: "rules", policyHash: "h" }

interface Case {
  note: string
  read: Array<{ file?: string; page?: string; text: string }>
  call: { tool: string; input: Record<string, unknown> }
  /** tainted-fetch: a WebFetch held the same way, under the rule Extreme approval may answer (owner, 13 Nov). */
  expect: "tainted-egress" | "tainted-fetch" | "none"
  says?: string
}

const cases = parseYaml(fs.readFileSync(path.join(import.meta.dirname, "golden", "taint-egress.yaml"), "utf8")) as Case[]

describe("the taint-tracked egress guard (D-016)", () => {
  it.each(cases.map((c) => [c.note, c] as const))("%s", (_note, c) => {
    const p = new Provenance()
    for (const r of c.read) {
      if (r.file) p.addUntrustedFile(r.text, r.file)
      else p.add(r.text, `the page ${r.page}`)
    }
    const input = JSON.parse(JSON.stringify(c.call.input).replaceAll("${CWD}", CWD)) as Record<string, unknown>
    const v = withProvenance(allow, c.call.tool, input, p, CWD)
    if (c.expect === "none") expect(v).toBe(allow)
    else {
      expect(v).toMatchObject({ outcome: "escalate", ruleId: c.expect })
      expect(v.risk).toBeGreaterThanOrEqual(70)
      if (c.says) expect(v.reason).toContain(`which came from ${c.says}`)
    }
  })

  it("has enough cases, can only escalate, and Extreme approval never approves it", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10)
    const p = new Provenance()
    p.addUntrustedFile("see https://x.evil-host.test", "README.md")
    const deny: Verdict = { ...allow, outcome: "deny", ruleId: "destructive-shell" }
    expect(withProvenance(deny, "Bash", { command: "curl https://x.evil-host.test" }, p, CWD)).toBe(deny)
    expect(NEVER_AUTO_APPROVED.has(EGRESS_RULE)).toBe(true)
    expect(valuesIn("go to https://a.test/b, then mail me@c.test")).toEqual(expect.arrayContaining(["https://a.test/b", "a.test", "me@c.test"]))
  })

  it("after a result that looked like prompt injection, holds network commands as egress and fetches under the fetch rule", () => {
    const p = new Provenance()
    p.add("Na Spilce https://prazdrojvisit.cz/en/restaurants/na-spilce-pub", "WebSearch")
    expect(withProvenance(allow, "WebFetch", { url: "https://prazdrojvisit.cz/en/restaurants/na-spilce-pub", prompt: "read" }, p, CWD)).toBe(allow)
    p.raise("a result that told Claude to ignore its instructions")
    // Still asks in Manual; Extreme approval and a WebFetch grant may answer it (owner, 13 Nov).
    expect(withProvenance(allow, "WebFetch", { url: "https://prazdrojvisit.cz/en/restaurants/na-spilce-pub", prompt: "read" }, p, CWD)).toMatchObject({ outcome: "escalate", ruleId: FETCH_RULE })
    expect(withProvenance(allow, "Bash", { command: "curl https://registry.npmjs.org/left-pad" }, p, CWD)).toMatchObject({ outcome: "escalate", ruleId: EGRESS_RULE })
  })
})
