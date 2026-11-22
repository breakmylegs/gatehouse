/**
 * E-020 (expansion, Wave E3): least-privilege IAM. A grant that is broader than it needs to be goes to a person, each
 * finding with a narrower alternative: an action or resource of * (or a whole service, s3:*), Owner or Contributor at
 * subscription scope (or Owner and Editor on a Google project), and a new administrator role (AdministratorAccess, User
 * Access Administrator, roles/owner and the like). Read from what an edit adds to a policy document, a Terraform, Bicep,
 * ARM or CloudFormation file, and from an apply's plan (iac-plan.ts). Read by words, as E-011 and E-023 are.
 */
import fs from "node:fs"

export const IAM_RULE = "broad-iam"
export const IAM_RISK = 80

export interface IamGrant {
  what: string
  suggest: string
}

const ROLE_IDS: Record<string, string> = {
  "8e3af657-a8ff-443c-a75c-2fe8c4bcb635": "Owner",
  "b24988ac-6180-42a0-ab88-20f7382dd24c": "Contributor",
  "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9": "User Access Administrator",
  "f58310d9-a9f6-439a-9e8d-f62e7b41a168": "Role Based Access Control Administrator",
}
const ADMIN_ROLES = /\b(AdministratorAccess|IAMFullAccess|PowerUserAccess|User Access Administrator|Role Based Access Control Administrator|Global Administrator|Privileged Role Administrator|roles\/owner|roles\/resourcemanager\.organizationAdmin|roles\/iam\.securityAdmin|roles\/iam\.serviceAccountTokenCreator)\b/

/** The broad grants in a text: a policy document, Terraform, Bicep, ARM or CloudFormation. */
export function iamGrants(text: string): IamGrant[] {
  const out = new Map<string, IamGrant>()
  const add = (what: string, suggest: string) => out.set(what, { what, suggest })
  // Actions and resources of * or a whole service, in JSON, YAML and HCL (Action, actions, NotAction left out).
  // A value: one quoted string, or a list of them (every item counts).
  const value = String.raw`\s*(?:=|:)\s*(\[[^\]]*\]|["'][^"'\n]*["'])`
  const items = (key: string) =>
    [...text.matchAll(new RegExp(String.raw`(?<![\w])(?:${key})${value}`, "g"))].flatMap((m) => [...m[1]!.matchAll(/["']([^"'\n]*)["']/g)].map((q) => q[1]!))
  const actions = items(String.raw`"Action"|'Action'|Action|actions`)
  const resources = items(String.raw`"Resource"|'Resource'|Resource|resources`)
  const allAction = actions.some((a) => a === "*")
  const allResource = resources.some((r) => r === "*")
  if (allAction && allResource) add("an action of * on a resource of * (everything, everywhere)", "name the actions the code calls (s3:GetObject, sqs:SendMessage) on the ARNs it uses")
  else if (allAction) add("an action of * (every action)", "name the actions the code calls, such as s3:GetObject and s3:PutObject")
  else if (allResource && actions.some((a) => !/:(Get|List|Describe)/.test(a))) add("a resource of * (every resource)", "name the ARNs it acts on, such as arn:aws:s3:::my-bucket/*")
  for (const a of new Set(actions.filter((x) => /^[a-z0-9-]+:\*$/i.test(x)))) add(`an action of ${a} (every ${a.split(":")[0]} action)`, `name the ${a.split(":")[0]} actions it needs, such as ${a.split(":")[0]}:Get* or the exact calls`)
  // Owner or Contributor at subscription scope (Azure), by name or role id, in Terraform, Bicep or ARM.
  // The subscription id must end the path, so a resource group's scope never counts.
  const subScope = /(scope\s*[=:]\s*["']?\/subscriptions\/[^"'/\s]+(?=["'\s]|$)|scope\s*[=:]\s*(data\.azurerm_subscription\.\w+\.id|subscription\(\)(\.id)?)|targetScope\s*=\s*'subscription')/i.test(text)
  for (const m of text.matchAll(/(?:role_definition_name|roleDefinitionName)\s*[=:]\s*["'](Owner|Contributor)["']/g)) if (subScope) add(`${m[1]} at subscription scope`, `assign a narrower built-in role (Reader, or the service's own Contributor such as Storage Blob Data Contributor) on the resource group or resource`)
  for (const [id, name] of Object.entries(ROLE_IDS)) if (text.toLowerCase().includes(id) && (name !== "Owner" && name !== "Contributor" ? true : subScope)) add(name === "Owner" || name === "Contributor" ? `${name} at subscription scope` : `the ${name} role`, name === "Owner" || name === "Contributor" ? "assign a narrower built-in role on the resource group or resource" : "grant it on one resource group, for a set time (Privileged Identity Management), or not at all")
  // Google: Owner or Editor on a project, folder or organisation.
  for (const m of text.matchAll(/role\s*[=:]\s*["'](roles\/(?:owner|editor))["']/g)) add(`${m[1]} on the project`, "use a predefined role for the service, such as roles/storage.objectViewer or roles/run.invoker")
  // New administrator roles.
  for (const m of text.matchAll(new RegExp(ADMIN_ROLES.source, "g"))) if (!out.has(`${m[0]} on the project`)) add(`the ${m[0]} role`, "grant only the permissions the task needs, in a custom role or a narrower managed policy")
  return [...out.values()]
}

const IAM_FILE = /\.(tf|tf\.json|hcl|bicep|json|ya?ml|template)$/i

const current = (abs: string | undefined): string => {
  if (!abs) return ""
  try {
    return fs.readFileSync(abs, "utf8")
  } catch {
    return ""
  }
}

export const iamReason = (grants: IamGrant[], what: string) =>
  `${what} grants more than it needs to: ${grants
    .slice(0, 4)
    .map((g) => `${g.what}; narrower: ${g.suggest}`)
    .join(". ")}${grants.length > 4 ? `. And ${grants.length - 4} more` : ""}.`

/** What an edit adds that grants too much; undefined when it adds nothing of that. */
export function iamFindings(tool: string, input: Record<string, unknown>, absPath: string | undefined): { ruleId: typeof IAM_RULE; reason: string; risk: number } | undefined {
  const file = typeof input.file_path === "string" ? input.file_path : ""
  if (!file || !IAM_FILE.test(file)) return undefined
  let before = ""
  let after = ""
  if (tool === "Write") {
    after = typeof input.content === "string" ? input.content : ""
    before = current(absPath)
  } else if (tool === "Edit") {
    before = typeof input.old_string === "string" ? input.old_string : ""
    after = typeof input.new_string === "string" ? input.new_string : ""
  } else if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const edits = input.edits as Array<{ old_string?: unknown; new_string?: unknown }>
    before = edits.map((e) => (typeof e.old_string === "string" ? e.old_string : "")).join("\n")
    after = edits.map((e) => (typeof e.new_string === "string" ? e.new_string : "")).join("\n")
  } else return undefined
  // A subscription scope set elsewhere in the file counts for a role named in the edit.
  const scope = tool === "Write" ? "" : (current(absPath).match(/targetScope\s*=\s*'subscription'|scope\s*[=:].*\/subscriptions\/[^\n]*/i)?.[0] ?? "")
  const had = new Set(iamGrants(before).map((g) => g.what))
  const added = iamGrants(`${scope}\n${after}`).filter((g) => !had.has(g.what))
  if (!added.length) return undefined
  return { ruleId: IAM_RULE, risk: IAM_RISK, reason: `${iamReason(added, "This change")} It waits for you.` }
}

/** A resource's settings as text the grant reader can read: each value on its own line, JSON in strings unpacked. */
export function settingsText(settings: unknown): string {
  const lines: string[] = []
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key))
    if (v && typeof v === "object") return void Object.entries(v as Record<string, unknown>).forEach(([k, x]) => walk(x, k))
    if (typeof v === "string") {
      const t = v.trim()
      if ((t.startsWith("{") || t.startsWith("[")) && t.length < 200_000)
        try {
          return walk(JSON.parse(t), key)
        } catch {
          // Not JSON: read as it is.
        }
      lines.push(`${key} = ${JSON.stringify(v)}`)
    }
  }
  walk(settings, "")
  return lines.join("\n")
}
