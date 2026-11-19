// T-134: a credential field may hold a 1Password reference: read with op when needed and only when switched on,
// never through a shell, redacted at once, and never an Anthropic credential.
import { describe, expect, it } from "vitest"
import { redactString } from "@gatehouse/policy"
import { isOpRef, resolveSecret, SecretTerms } from "../src/secret-providers.js"

describe("1Password references (T-134)", () => {
  it("passes a plain value through and reads a reference with op, without a shell, only when switched on", async () => {
    const calls: Array<[string, string[]]> = []
    const terms = new SecretTerms()
    let on = false
    const d = { enabled: () => on, terms, run: async (file: string, args: string[]) => (calls.push([file, args]), "xoxb-1234-abcd\n") }
    expect(await resolveSecret("xoxb-plain-value", d)).toBe("xoxb-plain-value")
    expect(await resolveSecret(undefined, d)).toBeUndefined()
    await expect(resolveSecret("op://Private/Slack/bot-token", d)).rejects.toThrow(/switched off/)
    expect(calls).toEqual([])
    on = true
    expect(await resolveSecret("op://Private/Slack/bot-token", d)).toBe("xoxb-1234-abcd")
    expect(calls).toEqual([["op", ["read", "--no-newline", "op://Private/Slack/bot-token"]]])
    expect(redactString("token xoxb-1234-abcd sent", { terms: terms.terms() })).not.toContain("xoxb-1234-abcd")
  })

  it("never reads or gives an Anthropic credential", async () => {
    const terms = new SecretTerms()
    const read = (value: string) => ({ enabled: () => true, terms, run: async () => value })
    await expect(resolveSecret("op://Work/Anthropic/key", read("x"))).rejects.toThrow(/Anthropic/)
    await expect(resolveSecret("op://Work/Claude Code/token".replace(" ", "-"), read("x"))).rejects.toThrow(/Anthropic/)
    await expect(resolveSecret("op://Work/Slack/bot", read("sk-ant-api03-abcdef"))).rejects.toThrow(/Anthropic credential/)
    expect(terms.terms()).toEqual([])
  })

  it("knows a reference from a value", () => {
    expect(isOpRef("op://Private/Slack/bot-token")).toBe(true)
    expect(isOpRef("op://Private/Slack/section/field")).toBe(true)
    expect(isOpRef("op://Private")).toBe(false)
    expect(isOpRef("op://a/b/c; rm -rf /")).toBe(false)
    expect(isOpRef("xoxb-123")).toBe(false)
  })
})
