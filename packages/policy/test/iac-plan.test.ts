// E-018: an infrastructure plan read as policy. Deleting or replacing a stateful resource is Severe and named; new public
// exposure is High; the golden plans (iac-golden.json, in the four shapes) decide as written.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { applyTool, exposures, IAC_DESTROY_RISK, IAC_DESTROY_RULE, IAC_EXPOSURE_RISK, isStateful, judgePlan, parsePlan, parsePlanText } from "../src/iac-plan.js"

interface Golden {
  name: string
  plan: unknown
  o: "escalate" | "none"
  r?: string
  names?: string[]
}
const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "iac-golden.json"), "utf8")) as Golden[]

describe("IaC plans as policy", () => {
  it("has at least 20 golden plans across the four tools", () => {
    expect(golden.length).toBeGreaterThanOrEqual(20)
    expect(new Set(golden.map((g) => parsePlan(g.plan)?.tool))).toEqual(new Set(["terraform", "arm", "cloudformation", "pulumi"]))
  })

  for (const g of golden)
    it(`golden: ${g.name}`, () => {
      const plan = parsePlan(g.plan)
      expect(plan, "the plan is read").toBeDefined()
      const f = judgePlan(plan!)
      if (g.o === "none") return void expect(f).toBeUndefined()
      expect(f?.ruleId).toBe(g.r)
      expect(f?.resources).toEqual(g.names)
      for (const n of g.names ?? []) expect(f?.reason).toContain(n.length > 120 ? n.slice(-117) : n)
    })

  it("names a deleted database at Severe, with its type", () => {
    const f = judgePlan(parsePlan({ format_version: "1.2", resource_changes: [{ address: "aws_db_instance.orders", type: "aws_db_instance", change: { actions: ["delete"] } }] })!)
    expect(f).toMatchObject({ ruleId: IAC_DESTROY_RULE, risk: IAC_DESTROY_RISK })
    expect(f?.reason).toMatch(/aws_db_instance\.orders \(aws_db_instance, deleted\)/)
    expect(IAC_DESTROY_RISK).toBeGreaterThanOrEqual(85)
    expect(IAC_EXPOSURE_RISK).toBeGreaterThanOrEqual(70)
    expect(IAC_EXPOSURE_RISK).toBeLessThan(85)
  })

  it("puts a deletion before an exposure when a plan has both", () => {
    const f = judgePlan(parsePlan({ format_version: "1", resource_changes: [
      { address: "aws_security_group_rule.any", type: "aws_security_group_rule", change: { actions: ["create"], before: null, after: { cidr_blocks: ["0.0.0.0/0"] } } },
      { address: "aws_rds_cluster.c", type: "aws_rds_cluster", change: { actions: ["delete", "create"] } },
    ] })!)
    expect(f?.ruleId).toBe(IAC_DESTROY_RULE)
  })

  it("knows what keeps data, and what only sits around it", () => {
    for (const t of ["aws_db_instance", "aws_s3_bucket", "azurerm_mssql_database", "Microsoft.Storage/storageAccounts", "AWS::SQS::Queue", "aws:rds/instance:Instance", "google_storage_bucket", "aws_ebs_volume", "azurerm_cosmosdb_account"]) expect(isStateful(t), t).toBe(true)
    for (const t of ["aws_db_subnet_group", "aws_s3_bucket_policy", "aws_instance", "Microsoft.Sql/servers/firewallRules", "aws_volume_attachment", "aws_lambda_function", "AWS::IAM::Role"]) expect(isStateful(t), t).toBe(false)
  })

  it("reads exposure in either naming, and only what is open to anyone", () => {
    expect(exposures({ ingress: [{ cidrBlocks: ["0.0.0.0/0"] }], acl: "public-read" })).toEqual(["acl public-read", "cidrBlocks 0.0.0.0/0"])
    expect(exposures({ cidr_blocks: ["10.0.0.0/8"], publicly_accessible: false })).toEqual([])
  })

  it("knows an apply by each tool, and reads plan output after other lines", () => {
    expect(applyTool("terraform -chdir=infra apply tfplan")).toBe("terraform")
    expect(applyTool("cd infra && tofu apply -auto-approve")).toBe("terraform")
    expect(applyTool("az deployment group create -g rg -f main.bicep")).toBe("arm")
    expect(applyTool("New-AzResourceGroupDeployment -ResourceGroupName rg -TemplateFile main.bicep")).toBe("arm")
    expect(applyTool("aws cloudformation execute-change-set --change-set-name cs")).toBe("cloudformation")
    expect(applyTool("pulumi up --yes")).toBe("pulumi")
    expect(applyTool("terraform plan -out tfplan")).toBeUndefined()
    expect(applyTool("az deployment group what-if -g rg -f main.bicep")).toBeUndefined()
    expect(parsePlanText('Note: preview\n{"steps":[{"op":"delete","urn":"urn:pulumi:s::p::aws:sqs/queue:Queue::q"}]}')?.changes[0]).toMatchObject({ action: "delete", type: "aws:sqs/queue:Queue" })
    expect(parsePlanText("no json here")).toBeUndefined()
  })
})
