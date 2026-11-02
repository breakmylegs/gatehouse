// Multi-provider S-04: the invariant conformance suite passes for the Claude adapter with Codehouse's own gate wrapper and
// executor, and fails, in the right category, for a provider broken on purpose in each one.
import { redactString } from "@gatehouse/policy"
import { describe, expect, it } from "vitest"
import { claudeAdapter } from "../src/providers/claude.js"
import {
  runConformance,
  type Category,
  type ConformanceSubject,
} from "../src/providers/conformance.js"
import { ToolExecutor } from "../src/providers/executor.js"
import { failClosed, inputHash } from "../src/providers/gate.js"

const good: ConformanceSubject = {
  adapter: claudeAdapter({
    account: () => ({ email: "a@example.com", organization: "Example Org" }),
  }),
  wrapGate: (inner, ms) => failClosed(inner, ms),
  executor: (root, secret) =>
    new ToolExecutor({ workspaceRoot: root, redact: (t) => redactString(t, { terms: [secret] }) }),
  orgs: { expected: "Example Org", other: "Another Org" },
}

const failed = async (s: ConformanceSubject) =>
  (await runConformance(s)).filter((f) => !f.ok).map((f) => f.category)

describe("the conformance suite", () => {
  it("passes for Claude with Codehouse's gate wrapper and executor", async () => {
    const findings = await runConformance(good)
    expect(findings.map((f) => f.category).sort()).toEqual([
      "edited-input",
      "gate-error",
      "gate-malformed",
      "gate-timeout",
      "no-bypass",
      "org-guard",
      "redaction",
    ])
    expect(findings.filter((f) => !f.ok)).toEqual([])
  })

  it("fails a provider broken in each category", async () => {
    const broken: Array<[Category, Partial<ConformanceSubject>]> = [
      // A gate passed through as it is: errors, a stuck gate and malformed answers all reach the loop.
      ["gate-error", { wrapGate: (inner) => inner }],
      ["gate-timeout", { wrapGate: (inner) => inner }],
      ["gate-malformed", { wrapGate: (inner) => inner }],
      [
        "no-bypass",
        {
          adapter: {
            ...good.adapter,
            capabilities: () => ({
              ...good.adapter.capabilities(),
              vendorSettings: { approvalPolicy: "never" },
            }),
          },
        },
      ],
      [
        "edited-input",
        {
          executor: (root, secret) => {
            const real = good.executor(root, secret)
            // Runs what the model asked for, not what was allowed.
            return {
              run: (c, v) =>
                real.run(c, { ...v, input: c.input, inputHash: inputHash(c.input) } as never),
            }
          },
        },
      ],
      [
        "redaction",
        { executor: (root) => new ToolExecutor({ workspaceRoot: root, redact: (t) => t }) },
      ],
      [
        "org-guard",
        {
          adapter: {
            ...good.adapter,
            assertOrganisation: async () => ({
              provider: "x",
              orgId: "x",
              accountLabel: "",
              verifiedBy: "nothing",
            }),
          },
        },
      ],
    ]
    for (const [category, change] of broken)
      expect(await failed({ ...good, ...change }), category).toContain(category)
  }, 60_000)
})
