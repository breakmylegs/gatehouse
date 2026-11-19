// T-135: a secret you give a session reaches one command, once, after that command is allowed as it stands; the
// edited command is checked again with the value masked; the value is redacted, never an Anthropic one, and never for
// a name Codehouse or Claude Code relies on.
import { describe, expect, it } from "vitest"
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import { redactString } from "@gatehouse/policy"
import { SecretTerms } from "../src/secret-providers.js"
import { MASK, refuseRequest, SecretRequests, withSecret, withSecrets } from "../src/secret-requests.js"

const opts = { signal: new AbortController().signal, toolUseID: "tu1" } as Parameters<CanUseTool>[2]
const CMD = "npm publish --registry https://registry.example"

async function given(value = "npm_abcdef123456") {
  const terms = new SecretTerms()
  const secrets = new SecretRequests(terms)
  const asked = secrets.ask("s1", "NPM_TOKEN", "to publish", CMD)
  const [a] = secrets.pending()
  expect(a).toMatchObject({ sessionId: "s1", name: "NPM_TOKEN", command: CMD })
  expect(JSON.stringify(secrets.pending())).not.toContain(value)
  expect(secrets.answer(a!.id, value)).toBeUndefined()
  expect(await asked).toBe("given")
  return { terms, secrets }
}

function wrapped(secrets: SecretRequests, decide: PermissionResult, blocked?: string) {
  const seen: Array<Record<string, unknown>> = []
  const recorded: Array<[string, boolean]> = []
  const inner: CanUseTool = async (_t, input) => (decide.behavior === "allow" ? { ...decide, updatedInput: (decide.updatedInput ?? input) as Record<string, unknown> } : decide)
  const canUse = withSecrets(inner, {
    sessionId: "s1",
    secrets,
    recheck: async (_t, input) => (seen.push(input), blocked ? { outcome: "deny", ruleId: "floor-x", reason: blocked, risk: 100, decidedBy: "floor", policyHash: "" } : undefined),
    record: async (name, ok) => (recorded.push([name, ok]), true),
  })
  return { canUse, seen, recorded }
}

describe("a secret for one command (T-135)", () => {
  it("is set only for that command, once, after it is allowed, checked again with the value masked", async () => {
    const { terms, secrets } = await given()
    const { canUse, seen, recorded } = wrapped(secrets, { behavior: "allow" })
    const other = await canUse("Bash", { command: "npm whoami" }, opts)
    expect(other).toMatchObject({ updatedInput: { command: "npm whoami" } })
    const r = await canUse("Bash", { command: CMD }, opts)
    expect(r).toMatchObject({ behavior: "allow", updatedInput: { command: `export NPM_TOKEN='npm_abcdef123456' && ${CMD}` } })
    expect(seen).toEqual([{ command: `export NPM_TOKEN='${MASK}' && ${CMD}` }])
    expect(recorded).toEqual([["NPM_TOKEN", true]])
    expect(await canUse("Bash", { command: CMD }, opts)).toMatchObject({ updatedInput: { command: CMD } })
    expect(redactString(`ran with npm_abcdef123456`, { terms: terms.terms() })).not.toContain("npm_abcdef123456")
  })

  it("is not set when the command was denied, edited by a person, or blocked when checked again", async () => {
    const kept = (await given()).secrets
    const denied = wrapped(kept, { behavior: "deny", message: "no" })
    expect(await denied.canUse("Bash", { command: CMD }, opts)).toEqual({ behavior: "deny", message: "no" })
    expect(denied.seen).toEqual([])
    // A denied run uses nothing up: the secret is still there for when the command is allowed.
    expect(kept.take("s1", CMD)).toMatchObject({ name: "NPM_TOKEN" })
    const edited = wrapped((await given()).secrets, { behavior: "allow", updatedInput: { command: `${CMD} --dry-run` } })
    expect(await edited.canUse("Bash", { command: CMD }, opts)).toMatchObject({ updatedInput: { command: `${CMD} --dry-run` } })
    expect(edited.seen).toEqual([])
    const blocked = wrapped((await given()).secrets, { behavior: "allow" }, "secrets in commands")
    const r = await blocked.canUse("Bash", { command: CMD }, opts)
    expect(r).toMatchObject({ behavior: "deny" })
    expect(JSON.stringify(r)).not.toContain("npm_abcdef123456")
    expect(blocked.recorded).toEqual([["NPM_TOKEN", false]])
  })

  it("quotes the value so nothing in it runs, in Bash and PowerShell", () => {
    expect(withSecret("Bash", "make", "T", "a'b $(rm -rf /)")).toBe(`export T='a'\\''b $(rm -rf /)' && make`)
    expect(withSecret("PowerShell", "make", "T", "a'b $(x)")).toBe(`$env:T = 'a''b $(x)'; make`)
  })

  it("refuses names Codehouse relies on, Anthropic credentials, and answers when nobody is waiting", async () => {
    expect(refuseRequest("ANTHROPIC_API_KEY", CMD)).toMatch(/relies on/)
    expect(refuseRequest("CLAUDE_CODE_OAUTH_TOKEN", CMD)).toMatch(/relies on/)
    expect(refuseRequest("PATH", CMD)).toMatch(/relies on/)
    expect(refuseRequest("npm_token", CMD)).toMatch(/capitals/)
    expect(refuseRequest("NPM_TOKEN", CMD)).toBeUndefined()
    const terms = new SecretTerms()
    const secrets = new SecretRequests(terms)
    void secrets.ask("s1", "NPM_TOKEN", "x", CMD)
    const [a] = secrets.pending()
    expect(secrets.answer(a!.id, "sk-ant-api03-abcdef")).toMatch(/Anthropic/)
    expect(terms.terms()).toEqual([])
    expect(secrets.answer("nope", "x")).toMatch(/no longer waiting/)
  })

  it("is forgotten when the session ends, and a request that is not answered ends", async () => {
    const { secrets } = await given()
    secrets.forget("s1")
    expect(secrets.take("s1", CMD)).toBeUndefined()
    const s2 = new SecretRequests(new SecretTerms())
    expect(await s2.ask("s1", "NPM_TOKEN", "x", CMD, 5)).toBe("timeout")
    expect(s2.pending()).toEqual([])
  })
})
