// E-020: grants broader than they need to be go to a person, each with a narrower alternative; in an edit only what it
// adds counts, and in an apply's plan only what the plan creates or widens.
import { describe, expect, it } from "vitest"
import { judgePlan, parsePlan } from "../src/iac-plan.js"
import { IAM_RISK, IAM_RULE, iamFindings, iamGrants, settingsText } from "../src/iam.js"

describe("least-privilege IAM", () => {
  it("escalates a grant of * on * with a suggestion", () => {
    const f = iamFindings("Write", { file_path: "C:/p/policy.json", content: '{"Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}' }, undefined)
    expect(f).toMatchObject({ ruleId: IAM_RULE, risk: IAM_RISK })
    expect(f?.reason).toMatch(/an action of \* on a resource of \* .*narrower: name the actions the code calls/)
    expect(IAM_RISK).toBeGreaterThanOrEqual(70)
  })

  it("counts only what an edit adds", () => {
    expect(iamFindings("Edit", { file_path: "C:/p/policy.json", old_string: '"Action": "*", "Resource": "*"', new_string: '"Action": "*", "Resource": "*", "Sid": "x"' }, undefined)).toBeUndefined()
    expect(iamFindings("Edit", { file_path: "C:/p/policy.json", old_string: '"Action": ["s3:GetObject"]', new_string: '"Action": ["s3:GetObject", "s3:*"]' }, undefined)?.reason).toMatch(/s3:\* \(every s3 action\)/)
    expect(iamFindings("Write", { file_path: "C:/p/README.md", content: '"Action": "*"' }, undefined)).toBeUndefined()
  })

  it("reads each kind of broad grant", () => {
    const whats = (t: string) => iamGrants(t).map((g) => g.what)
    expect(whats('actions = ["s3:GetObject", "*"]')).toEqual(["an action of * (every action)"])
    expect(whats('Action = "s3:PutObject"\nResource = "*"')).toEqual(["a resource of * (every resource)"])
    expect(whats('Action = "ec2:DescribeInstances"\nResource = "*"')).toEqual([])
    expect(whats('scope = "/subscriptions/1"\nrole_definition_name = "Owner"')).toEqual(["Owner at subscription scope"])
    expect(whats('scope = "/subscriptions/0000-1111/resourceGroups/rg"\nrole_definition_name = "Owner"')).toEqual([])
    expect(whats("roleDefinitionId: '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9'")).toEqual(["the User Access Administrator role"])
    expect(whats('role = "roles/editor"')).toEqual(["roles/editor on the project"])
    expect(whats('policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"')).toEqual(["the AdministratorAccess role"])
  })

  it("holds an apply whose plan creates a broad grant, reading policy JSON inside the plan's strings", () => {
    const plan = parsePlan({ format_version: "1.2", resource_changes: [
      { address: "aws_iam_policy.ci", type: "aws_iam_policy", change: { actions: ["create"], before: null, after: { policy: JSON.stringify({ Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] }) } } },
      { address: "aws_iam_policy.ok", type: "aws_iam_policy", change: { actions: ["update"], before: { policy: '{"Statement":[{"Action":"*","Resource":"*"}]}' }, after: { policy: '{"Statement":[{"Action":"*","Resource":"*"}]}', description: "same grant" } } },
    ] })!
    const f = judgePlan(plan)
    expect(f).toMatchObject({ ruleId: IAM_RULE, risk: IAM_RISK, resources: ["aws_iam_policy.ci"] })
    expect(f?.reason).toMatch(/aws_iam_policy\.ci grants more than it needs to/)
    expect(settingsText({ a: { b: '{"Action":["x:Y"]}' } })).toBe('Action = "x:Y"')
  })

  it("puts a deletion first and an exposure after it", () => {
    const plan = parsePlan({ format_version: "1.2", resource_changes: [
      { address: "aws_security_group_rule.any", type: "aws_security_group_rule", change: { actions: ["create"], before: null, after: { cidr_blocks: ["0.0.0.0/0"] } } },
      { address: "aws_iam_policy.ci", type: "aws_iam_policy", change: { actions: ["create"], before: null, after: { policy: '{"Statement":[{"Action":"*","Resource":"*"}]}' } } },
    ] })!
    expect(judgePlan(plan)?.ruleId).toBe(IAM_RULE)
  })
})
