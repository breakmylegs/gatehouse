import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk"
import { checkOrg } from "../account.js"
import { CLAUDE_PROVIDER } from "./registry.js"
import type { OrgAssertion, ProviderAdapter, ProviderCapabilities } from "./types.js"

/**
 * Claude behind the provider contract (S-02). It describes what the Claude Agent SDK path does today and checks the
 * organisation the same way; sessions still start through SessionManager, unchanged, until a second provider needs
 * the contract to start one (a deviation from the plan's S-02, recorded in the build report: moving the live session
 * path now would change the most safety-critical code for no user-visible gain).
 */
export function claudeAdapter(deps: { account: () => AccountInfo | undefined }): ProviderAdapter {
  return {
    id: CLAUDE_PROVIDER,
    label: "Claude",
    capabilities: (): ProviderCapabilities => ({
      pattern: "wrap",
      streaming: true,
      resume: true,
      fork: true,
      compaction: "native",
      subagents: "native",
      inProcessMcp: true,
      // WebSearch is Claude Code's own tool, but it passes the floor and the Approver like any other.
      webSearch: "app-tool",
      imageInput: true,
      fileInput: true,
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      reportsUsage: true,
      reportsRateLimits: true,
      dataBoundary: "hosted-retained",
      // What sessions are started with: the mode set on every session, and the gate wired into the agent.
      vendorSettings: {
        permissionMode: "set on every session to default, plan, acceptEdits or auto",
        canUseTool: true,
        preToolUseFloorHook: true,
      },
    }),
    assertOrganisation: async (expectedOrgIds): Promise<OrgAssertion> => {
      const account = deps.account()
      let last = "No expected organisation is set."
      for (const expected of expectedOrgIds) {
        const r = checkOrg(account, expected)
        if (r.ok)
          return {
            provider: CLAUDE_PROVIDER,
            orgId: expected,
            accountLabel: account?.email ?? "",
            verifiedBy: "init.account.organization",
          }
        last = r.message
      }
      throw new Error(last)
    },
  }
}
