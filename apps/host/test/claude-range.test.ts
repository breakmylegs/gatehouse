// B04: sessions run only the Claude Code versions this release was checked with.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { CLAUDE_CODE_RANGE, inClaudeRange, rangeText } from "../src/claude-range.js"

const REPO = path.resolve(import.meta.dirname, "../../..")

describe("the Claude Code versions a release was checked with", () => {
  it("hold the bundled Claude Code, so upgrading the Agent SDK needs the new version checked and written down", () => {
    // The Agent SDK 0.3.N bundles Claude Code 2.1.N. If this fails after an upgrade, check what the new version
    // changes in how calls are decided (docs/sdk-notes.md), then widen CLAUDE_CODE_RANGE in claude-range.ts.
    const sdk = JSON.parse(
      fs.readFileSync(
        path.join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json"),
        "utf8",
      ),
    ) as { version: string }
    const patch = /^0\.3\.(\d+)$/.exec(sdk.version)?.[1]
    expect(patch, `an Agent SDK version this test does not know: ${sdk.version}`).toBeDefined()
    expect(inClaudeRange(`2.1.${patch}`)).toBe(true)
  })

  it("let in only plain versions within the range", () => {
    expect(inClaudeRange(CLAUDE_CODE_RANGE.from)).toBe(true)
    expect(inClaudeRange(CLAUDE_CODE_RANGE.to)).toBe(true)
    expect(inClaudeRange("2.1.309")).toBe(false)
    expect(inClaudeRange("2.2.0")).toBe(false)
    expect(inClaudeRange("9.9.9")).toBe(false)
    expect(inClaudeRange("2.1.310-beta")).toBe(false)
    expect(inClaudeRange(undefined)).toBe(false)
    expect(inClaudeRange(2)).toBe(false)
    expect(rangeText()).toMatch(/^Claude Code \d/)
  })
})
