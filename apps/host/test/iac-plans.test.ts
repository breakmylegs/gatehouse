// E-018: an apply inherits the strictest finding of the plan the session showed (or a recent plan file); a plan that
// deletes a database escalates as Severe, naming it; Max approval (O45) approves it, audited, and Manual asks.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { createPostToolHook, type SessionHookDeps } from "../src/hooks.js"
import { computePayloadHash, phonePayload } from "@gatehouse/shared"
import { IAC_UNSEEN_RULE, IacPlans, outputText, planFiles } from "../src/iac-plans.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-iac-test-"))
  dirs.push(d)
  return d
}

const deletesDb = JSON.stringify({ format_version: "1.2", resource_changes: [{ address: "aws_db_instance.orders", type: "aws_db_instance", change: { actions: ["delete"] } }] })
const clean = JSON.stringify({ format_version: "1.2", resource_changes: [{ address: "aws_lambda_function.api", type: "aws_lambda_function", change: { actions: ["update"], before: {}, after: {} } }] })

function canUseWith(plans: IacPlans, cwd: string, extreme = false) {
  const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
  const canUse = createCanUseTool({
    sessionId: "s1", cwd, project: "infra",
    approver: { evaluate: async () => ({ outcome: "allow", ruleId: "safe-shell", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
    broker: { request }, audit: { record: async () => true }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
    decided: new Set<string>(), extreme: () => extreme, effects: async () => undefined, log: () => undefined,
    iacPlan: (command: string) => plans.forCommand("s1", command, cwd),
  } as unknown as CanUseDeps)
  const call = (command: string) => canUse("Bash", { command }, { toolUseID: "t", signal: new AbortController().signal } as never)
  return { call, request }
}

describe("infrastructure applies and their plans", () => {
  it("escalates an apply of a plan that deletes a database as Severe, naming it", async () => {
    const plans = new IacPlans()
    plans.seen("s1", outputText({ stdout: deletesDb, stderr: "" }))
    const t = canUseWith(plans, tmp())
    expect((await t.call("terraform apply tfplan"))?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: "iac-destroys-stateful", risk: 90, reason: expect.stringContaining("aws_db_instance.orders") }) }))
  })

  it("is approved by Max approval only as you chose, audited, and asks you in Manual (O45)", async () => {
    const plans = new IacPlans()
    plans.seen("s1", deletesDb)
    const max = canUseWith(plans, tmp(), true)
    expect((await max.call("terraform apply -auto-approve tfplan"))?.behavior).toBe("allow")
    expect(max.request).not.toHaveBeenCalled()
    const manual = canUseWith(plans, tmp())
    expect((await manual.call("terraform apply -auto-approve tfplan"))?.behavior).toBe("deny")
    expect(manual.request).toHaveBeenCalledOnce()
  })

  it("lets an apply of a clean plan through, and holds one whose plan was never seen", async () => {
    const plans = new IacPlans()
    plans.seen("s1", clean)
    const t = canUseWith(plans, tmp())
    expect((await t.call("terraform apply tfplan"))?.behavior).toBe("allow")
    expect((await t.call("pulumi up --yes"))?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: IAC_UNSEEN_RULE, reason: expect.stringMatching(/pulumi preview --json/) }) }))
    expect((await t.call("terraform plan -out tfplan"))?.behavior).toBe("allow")
  })

  it("reads a recent plan file in the folder, and leaves an old one", async () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, "infra"))
    fs.writeFileSync(path.join(dir, "infra", "tfplan.json"), deletesDb)
    fs.writeFileSync(path.join(dir, "old.plan.json"), clean)
    const old = new Date(Date.now() - 7 * 3600_000)
    fs.utimesSync(path.join(dir, "old.plan.json"), old, old)
    expect(planFiles(dir)).toEqual([path.join(dir, "infra", "tfplan.json")])
    const t = canUseWith(new IacPlans(), dir)
    expect((await t.call("cd infra && terraform apply tfplan"))?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: "iac-destroys-stateful" }) }))
  })

  it("puts what depends on a replaced network on the card, and leaves a request without it hashing as before (E-024)", async () => {
    const plans = new IacPlans()
    plans.seen("s1", JSON.stringify({
      format_version: "1.2",
      resource_changes: [{ address: "azurerm_virtual_network.main", type: "azurerm_virtual_network", change: { actions: ["delete", "create"] } }],
      configuration: { root_module: { resources: [
        { address: "azurerm_virtual_network.main", expressions: {} },
        { address: "azurerm_subnet.app", expressions: { virtual_network_name: { references: ["azurerm_virtual_network.main.name"] } } },
        { address: "azurerm_linux_virtual_machine.web", expressions: { subnet: { references: ["azurerm_subnet.app.id"] } } },
      ] } },
    }))
    const cwd = tmp()
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const canUse = createCanUseTool({
      sessionId: "s1", cwd, project: "infra",
      approver: { evaluate: async () => ({ outcome: "escalate", ruleId: "cloud-read-change", reason: "Changes cloud resources.", risk: 90, decidedBy: "rules", policyHash: "h" }) },
      broker: { request }, audit: { record: async () => true }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
      decided: new Set<string>(), extreme: () => false, effects: async () => undefined, log: () => undefined,
      iacPlan: (c: string) => plans.forCommand("s1", c, cwd), iacBlast: (c: string) => plans.blastFor("s1", c, cwd),
    } as unknown as CanUseDeps)
    await canUse("Bash", { command: "terraform apply tfplan" }, { toolUseID: "t", signal: new AbortController().signal } as never)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      verdict: expect.objectContaining({ ruleId: "cloud-read-change" }),
      blast: [{ resource: "azurerm_virtual_network.main", action: "replace", dependents: ["azurerm_linux_virtual_machine.web", "azurerm_subnet.app"], more: 0 }],
    }))
    const base = { id: "r", nonce: "n", kind: "permission" as const, sessionId: "s", toolUseId: "t", toolName: "Bash", input: {}, cwd: "c", project: "p", verdict: { outcome: "escalate" as const, ruleId: "x", reason: "y", risk: 1, decidedBy: "rules" as const, policyHash: "h" }, createdAt: "a", expiresAt: "b" }
    expect(phonePayload(base)).not.toHaveProperty("blast")
    expect(computePayloadHash({ ...base, blast: [] })).toBe(computePayloadHash(base))
    expect(phonePayload({ ...base, blast: [{ resource: "v", action: "delete", dependents: ["s"], more: 0 }] })).toHaveProperty("blast")
  })

  it("hears what a successful command printed, from the PostToolUse hook", async () => {
    const outputs: unknown[] = []
    const hook = createPostToolHook({ sessionId: "s1", cwd: "C:/dev/infra", policy: () => undefined, pwsh: undefined, audit: { record: async () => true }, kill: () => false, decided: new Set(["t1", "t2"]), onEvent: () => undefined, log: () => undefined, onCommandOutput: (o: unknown) => outputs.push(o) } as unknown as SessionHookDeps)
    const signal = new AbortController().signal
    const post = (event: string, id: string) => ({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "terraform show -json tfplan" }, tool_use_id: id, tool_response: { stdout: deletesDb }, error: "x", cwd: "C:/dev/infra" }) as never
    await hook(post("PostToolUse", "t1"), "t1", { signal })
    await hook(post("PostToolUseFailure", "t2"), "t2", { signal })
    expect(outputs).toEqual([{ stdout: deletesDb }])
  })

  it("keeps each session's plans to itself, and the strictest when there are several", () => {
    const plans = new IacPlans()
    plans.seen("other", deletesDb)
    expect(plans.forCommand("s1", "terraform apply", tmp())?.ruleId).toBe(IAC_UNSEEN_RULE)
    const dir = tmp()
    fs.writeFileSync(path.join(dir, "plan.json"), deletesDb)
    // The session's own plan opens a port (High), the file deletes a database (Severe): the Severe one wins.
    plans.seen("s1", JSON.stringify({ format_version: "1.2", resource_changes: [{ address: "aws_security_group_rule.any", type: "aws_security_group_rule", change: { actions: ["create"], before: null, after: { cidr_blocks: ["0.0.0.0/0"] } } }] }))
    expect(plans.forCommand("s1", "terraform apply", dir)?.ruleId).toBe("iac-destroys-stateful")
  })
})
