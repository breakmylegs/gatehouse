// E-022: infrastructure misconfiguration checks in process: the seeded misconfigurations are found, each once, and the
// benign fixtures are clean.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { IAC_PARSERS, iacFormat, lintIac, readBicep, readHcl } from "../src/iac-lint.js"

const dir = path.join(import.meta.dirname, "iac-lint")
const load = (names: string[]) => names.map((n) => ({ file: n, text: fs.readFileSync(path.join(dir, n), "utf8") }))

describe("infrastructure misconfiguration checks", () => {
  it("finds the seeded misconfigurations, each once, with its file and line", () => {
    const found = lintIac(load(["bad.tf", "bad.bicep", "bad-arm.json", "bad-cfn.yaml"]))
    expect(found.map((f) => `${f.file} ${f.rule} ${f.resource}`).sort()).toEqual(
      [
        "bad.tf open-security-group aws_security_group web",
        "bad.tf public-storage aws_s3_bucket_public_access_block assets",
        "bad.tf missing-encryption aws_db_instance orders",
        "bad.tf weak-tls azurerm_storage_account data",
        "bad.tf missing-diagnostics azurerm_storage_account data",
        "bad.tf missing-diagnostics aws_lb front",
        "bad.bicep missing-diagnostics Microsoft.KeyVault/vaults kv",
        "bad.bicep weak-tls Microsoft.Web/sites web",
        "bad-arm.json open-security-group Microsoft.Network/networkSecurityGroups nsg-web",
        "bad-cfn.yaml public-storage AWS::S3::Bucket Logs",
        "bad-cfn.yaml missing-encryption AWS::EC2::Volume Disk",
      ].sort(),
    )
    expect(found.length).toBeGreaterThanOrEqual(10)
    expect(found.find((f) => f.resource === "aws_db_instance orders")).toMatchObject({ line: 18, fix: expect.stringMatching(/storage_encrypted/) })
    expect(found.find((f) => f.resource === "AWS::EC2::Volume Disk")?.line).toBe(8)
    // The volume's template uses !Select and !GetAZs; it is still read.
    expect(found.find((f) => f.resource === "AWS::EC2::Volume Disk")?.message).toMatch(/Encrypted is false/i)
  })

  it("finds nothing in the benign fixtures", () => {
    expect(lintIac(load(["good.tf", "good.bicep", "good-cfn.yaml"]))).toEqual([])
  })

  it("reads HCL and Bicep blocks, lists and nested blocks", () => {
    const [sg] = readHcl("a.tf", 'resource "aws_security_group" "x" {\n  ingress {\n    cidr_blocks = ["10.0.0.0/8", "0.0.0.0/0"]\n  }\n  ingress {\n    from_port = 443\n  }\n  tags = { Name = "x" }\n  vpc_id = aws_vpc.main.id\n}\n')
    expect(sg?.props).toEqual({ ingress: [{ cidr_blocks: ["10.0.0.0/8", "0.0.0.0/0"] }, { from_port: 443 }], tags: { Name: "x" }, vpc_id: "aws_vpc.main.id" })
    const [b] = readBicep("a.bicep", "resource s 'Microsoft.Storage/storageAccounts@2023-01-01' = if (deploy) {\n  name: 'x'\n  properties: {\n    allowBlobPublicAccess: true\n    rules: [\n      'a'\n      'b'\n    ]\n  }\n}\n")
    expect(b).toMatchObject({ type: "Microsoft.Storage/storageAccounts", name: "s", line: 1, props: { name: "x", properties: { allowBlobPublicAccess: true, rules: ["a", "b"] } } })
  })

  it("knows each format by its name and words, and records which parser reads it", () => {
    expect(iacFormat("main.tf", "")).toBe("hcl")
    expect(iacFormat("main.bicep", "")).toBe("bicep")
    expect(iacFormat("azuredeploy.json", '{"$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#"}')).toBe("arm")
    expect(iacFormat("stack.yaml", "Resources:\n  B:\n    Type: AWS::S3::Bucket\n")).toBe("cloudformation")
    expect(iacFormat("package.json", '{"name": "x"}')).toBeUndefined()
    expect(iacFormat("values.yaml", "replicas: 2\n")).toBeUndefined()
    expect(Object.keys(IAC_PARSERS)).toEqual(["hcl", "bicep", "arm", "cloudformation"])
  })
})
