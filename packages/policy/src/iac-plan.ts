/**
 * E-018 (expansion, Wave E3): an infrastructure plan read as policy. The plan output of terraform show -json (and
 * OpenTofu's), Bicep and ARM what-if JSON, a CloudFormation change set (describe-change-set) and pulumi preview --json
 * is read into one list of changes. Deleting or replacing a stateful resource (a database, storage, a key vault or
 * secret store, a queue or stream, a disk) is Severe; opening something new to the internet (an ingress from anywhere,
 * a public address, public access switched on) is High. An apply inherits the strictest finding of the plan it applies,
 * naming each resource.
 *
 * A grant broader than it needs to be (E-020, iam.ts) is High too, after a deletion and before an exposure.
 *
 * Pure: the Host keeps the plans it sees (a session's own plan output, and plan files in its folder) and asks here.
 */
import { IAM_RISK, IAM_RULE, iamGrants, iamReason, settingsText } from "./iam.js"

export const IAC_DESTROY_RULE = "iac-destroys-stateful"
export const IAC_DESTROY_RISK = 90
export const IAC_EXPOSURE_RULE = "iac-public-exposure"
export const IAC_EXPOSURE_RISK = 75

export type IacTool = "terraform" | "arm" | "cloudformation" | "pulumi"
export type IacAction = "create" | "update" | "delete" | "replace"

export interface IacChange {
  /** The resource's address or id, as the plan names it. */
  address: string
  /** Its type, as the provider names it (aws_db_instance, Microsoft.Sql/servers/databases, AWS::RDS::DBInstance, aws:rds/instance:Instance). */
  type: string
  action: IacAction
  before?: unknown
  after?: unknown
  /** The addresses it depends on, when the plan says (Terraform's configuration, Pulumi's dependencies). */
  dependsOn?: string[]
}

export interface IacPlan {
  tool: IacTool
  changes: IacChange[]
  /** E-024: what each resource depends on, changed or not (Terraform's configuration, Pulumi's steps). */
  graph?: Record<string, string[]>
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** Terraform's configuration: each resource's depends_on and the resources its expressions refer to. */
function terraformDeps(config: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walkModule = (m: Record<string, unknown>, prefix: string) => {
    for (const r of arr(m.resources).map(rec)) {
      const refs = new Set<string>(arr(r.depends_on).map(str).filter(Boolean))
      const scan = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(scan)
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>
          for (const ref of arr(o.references).map(str)) {
            const m2 = /^((?:data\.)?[a-z][\w-]*\.[\w-]+)/.exec(ref)
            if (m2) refs.add(m2[1]!)
          }
          for (const x of Object.values(o)) scan(x)
        }
      }
      scan(r.expressions)
      out.set(`${prefix}${str(r.address)}`, [...refs].map((x) => `${prefix}${x}`).filter((x) => x !== `${prefix}${str(r.address)}`))
    }
    for (const [name, call] of Object.entries(rec(m.module_calls))) walkModule(rec(rec(call).module), `${prefix}module.${name}.`)
  }
  walkModule(rec(rec(config).root_module), "")
  return out
}

function terraform(v: Record<string, unknown>): IacPlan {
  const deps = terraformDeps(v.configuration)
  const changes: IacChange[] = []
  for (const rc of arr(v.resource_changes).map(rec)) {
    const change = rec(rc.change)
    const actions = arr(change.actions).map(str)
    const action: IacAction | undefined = actions.includes("delete") && actions.includes("create") ? "replace" : actions.includes("delete") ? "delete" : actions.includes("create") ? "create" : actions.includes("update") ? "update" : undefined
    if (!action) continue
    const address = str(rc.address)
    const configAddress = address.replace(/\[[^\]]*\]/g, "")
    changes.push({ address, type: str(rc.type), action, before: change.before, after: change.after, ...(deps.has(configAddress) ? { dependsOn: deps.get(configAddress)! } : {}) })
  }
  return { tool: "terraform", changes, ...(deps.size ? { graph: Object.fromEntries(deps) } : {}) }
}

function arm(v: Record<string, unknown>): IacPlan {
  const list = arr(v.changes ?? rec(v.properties).changes)
  const changes: IacChange[] = []
  for (const c of list.map(rec)) {
    const t = str(c.changeType).toLowerCase()
    const action: IacAction | undefined = t === "delete" ? "delete" : t === "create" ? "create" : t === "modify" || t === "deploy" ? "update" : undefined
    if (!action) continue
    const id = str(c.resourceId)
    // After providers/: the namespace, then a type and a name for each level.
    const type = /\/providers\/([^/]+(?:\/[^/]+\/[^/]+)+)$/i.exec(id)?.[1]?.split("/").filter((_, i) => i === 0 || i % 2 === 1).join("/") ?? str(rec(c.after).type)
    changes.push({ address: id, type, action, before: c.before, after: c.after })
  }
  return { tool: "arm", changes }
}

function cloudformation(v: Record<string, unknown>): IacPlan {
  const changes: IacChange[] = []
  for (const c of arr(v.Changes).map(rec)) {
    const r = rec(c.ResourceChange)
    const a = str(r.Action)
    const replace = str(r.Replacement) === "True" || str(r.Replacement) === "Conditional"
    const action: IacAction | undefined = a === "Remove" ? "delete" : a === "Add" ? "create" : a === "Modify" ? (replace ? "replace" : "update") : undefined
    if (!action) continue
    changes.push({ address: str(r.LogicalResourceId) || str(r.PhysicalResourceId), type: str(r.ResourceType), action })
  }
  return { tool: "cloudformation", changes }
}

function pulumi(v: Record<string, unknown>): IacPlan {
  const changes: IacChange[] = []
  const seen = new Set<string>()
  const graph: Record<string, string[]> = {}
  for (const s of arr(v.steps).map(rec)) {
    const st = rec(s.newState ?? s.oldState)
    const d = arr(st.dependencies).map(str).filter(Boolean)
    if (str(s.urn) && d.length) graph[str(s.urn)] = d
  }
  for (const s of arr(v.steps).map(rec)) {
    const op = str(s.op)
    const action: IacAction | undefined = ["replace", "create-replacement", "delete-replaced"].includes(op) ? "replace" : op === "delete" ? "delete" : op === "create" ? "create" : op === "update" ? "update" : undefined
    const urn = str(s.urn)
    if (!action || seen.has(urn)) continue
    seen.add(urn)
    const state = rec(s.newState ?? s.oldState)
    const type = str(state.type) || urn.split("::")[2] || ""
    const deps = arr(state.dependencies).map(str).filter(Boolean)
    changes.push({ address: urn, type, action, before: rec(s.oldState).inputs, after: rec(s.newState).inputs, ...(deps.length ? { dependsOn: deps } : {}) })
  }
  return { tool: "pulumi", changes, ...(Object.keys(graph).length ? { graph } : {}) }
}

/** A plan in any of the four shapes; undefined when the JSON is none of them. */
export function parsePlan(json: unknown): IacPlan | undefined {
  const v = rec(json)
  if (Array.isArray(v.resource_changes) && (v.format_version !== undefined || v.terraform_version !== undefined)) return terraform(v)
  if (Array.isArray(v.changes) && arr(v.changes).some((c) => "changeType" in rec(c))) return arm(v)
  if (Array.isArray(rec(v.properties).changes)) return arm(v)
  if (Array.isArray(v.Changes) && (v.ChangeSetId !== undefined || v.ChangeSetName !== undefined || arr(v.Changes).some((c) => "ResourceChange" in rec(c)))) return cloudformation(v)
  if (Array.isArray(v.steps) && arr(v.steps).some((s) => "op" in rec(s) && "urn" in rec(s))) return pulumi(v)
  return undefined
}

/** Plan text as a session saw it: JSON, or JSON after a line of other output. */
export function parsePlanText(text: string): IacPlan | undefined {
  const start = text.indexOf("{")
  if (start < 0) return undefined
  try {
    return parsePlan(JSON.parse(text.slice(start)))
  } catch {
    return undefined
  }
}

/** Resources that keep data: databases, storage, secret stores and keys, queues and streams, disks. */
const STATEFUL =
  /(^|[_:/.\s-])(db|rds|sql|mssql|database|dynamodb|cosmosdb|documentdb|postgres(ql)?|mysql|mariadb|dbfor\w*|redis|elasticache|cache|spanner|bigtable|bigquery|firestore|datastore|docdb|neptune|redshift|opensearch\w*|elasticsearch|s3|s3_bucket|storage\w*|bucket|blob|filesystem|file_system|efs|fsx|ebs|volume|disks?|managed_disk|key_?vaults?|kms|secrets?(manager|_manager)?|secret_manager_secret|sqs|queue|servicebus|eventhubs?|event_hub\w*|pubsub|kinesis|backup\w*|snapshot)([_:/.\s-]|$)/i

/** Settings around a data store rather than the store itself: deleting one loses no data. */
const AROUND =
  /(polic(y|ies)|subnet_?group|parameter_?group|option_?group|_acl$|notification|public_?access_?block|versioning|lifecycle|cors|role|assignment|rule|firewall|endpoint|alarm|diagnostic|logging|website|ownership|encryption|accelerate|replication|attachment|association|alias|grant|tag)/i

export const isStateful = (type: string) => {
  const t = type.replace(/([a-z])([A-Z])/g, "$1_$2")
  return STATEFUL.test(t) && !AROUND.test(t)
}

const OPEN_RANGE = /^(0\.0\.0\.0\/0|::\/0|\*|internet|any)$/i
/** Setting names with their case, underscores and hyphens taken out, so Terraform's, ARM's and Pulumi's read alike. */
const RANGE_KEYS = new Set(["cidrblocks", "ipv6cidrblocks", "cidripv4", "cidripv6", "cidrip", "sourceranges", "sourceaddressprefix", "sourceaddressprefixes", "iprange", "startipaddress"])
const TRUE_OPENS = new Set(["publiclyaccessible", "associatepublicipaddress", "allownesteditemstobepublic", "allowblobpublicaccess", "publicnetworkaccessenabled", "mappubliciponlaunch"])
const FALSE_OPENS = new Set(["blockpublicacls", "blockpublicpolicy", "ignorepublicacls", "restrictpublicbuckets"])

/** What in a resource's settings opens it to the internet, in words; empty when nothing does. */
export function exposures(settings: unknown): string[] {
  const out = new Set<string>()
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key))
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k)
      return
    }
    const k = key.toLowerCase().replace(/[-_]/g, "")
    if (RANGE_KEYS.has(k) && typeof v === "string" && OPEN_RANGE.test(v.trim())) out.add(`${key} ${v}`)
    if (TRUE_OPENS.has(k) && v === true) out.add(`${key} true`)
    if (FALSE_OPENS.has(k) && v === false) out.add(`${key} false`)
    if (k === "publicnetworkaccess" && v === "Enabled") out.add(`${key} Enabled`)
    // CloudFormation names it AccessControl, PublicRead.
    if ((k === "acl" || k === "cannedacl" || k === "accesscontrol") && typeof v === "string" && /^public-?read(-?write)?$/i.test(v)) out.add(`${key} ${v}`)
    if ((k === "containeraccesstype" || k === "publicaccess") && typeof v === "string" && /^(blob|container)$/i.test(v)) out.add(`${key} ${v}`)
    if (k === "principal" && v === "*") out.add("Principal *")
  }
  walk(settings, "")
  return [...out].sort()
}

export interface IacFinding {
  ruleId: typeof IAC_DESTROY_RULE | typeof IAC_EXPOSURE_RULE | typeof IAM_RULE
  risk: number
  reason: string
  /** The resources it names. */
  resources: string[]
}

const short = (a: string) => (a.length > 120 ? `...${a.slice(-117)}` : a)

/** The strictest finding in a plan, naming each resource; undefined when it has none. */
export function judgePlan(plan: IacPlan): IacFinding | undefined {
  const destroys = plan.changes.filter((c) => (c.action === "delete" || c.action === "replace") && isStateful(c.type))
  if (destroys.length)
    return {
      ruleId: IAC_DESTROY_RULE,
      risk: IAC_DESTROY_RISK,
      resources: destroys.map((c) => c.address),
      reason: `This applies a plan that ${destroys.length === 1 ? "" : `${destroys.length} times `}deletes or replaces a resource that keeps data, which cannot be undone: ${destroys
        .slice(0, 5)
        .map((c) => `${short(c.address)} (${c.type}, ${c.action === "delete" ? "deleted" : "replaced"})`)
        .join(", ")}${destroys.length > 5 ? `, and ${destroys.length - 5} more` : ""}.`,
    }
  // E-020: a grant the plan creates or widens that is broader than it needs to be (High, 80).
  const granted = plan.changes
    .filter((c) => c.action !== "delete")
    .map((c) => {
      const was = new Set(iamGrants(settingsText(c.before)).map((g) => g.what))
      return { c, grants: iamGrants(settingsText(c.after)).filter((g) => !was.has(g.what)) }
    })
    .filter((x) => x.grants.length)
  if (granted.length)
    return {
      ruleId: IAM_RULE,
      risk: IAM_RISK,
      resources: granted.map((x) => x.c.address),
      reason: granted
        .slice(0, 3)
        .map((x) => iamReason(x.grants, `This applies a plan where ${short(x.c.address)}`))
        .join(" "),
    }
  const opened = plan.changes
    .filter((c) => c.action !== "delete")
    .map((c) => {
      const was = new Set(exposures(c.before))
      return { c, now: exposures(c.after).filter((e) => !was.has(e)) }
    })
    .filter((x) => x.now.length || (x.c.action === "create" && /public_?ip|publicipaddress|eip$/i.test(x.c.type)))
  if (opened.length)
    return {
      ruleId: IAC_EXPOSURE_RULE,
      risk: IAC_EXPOSURE_RISK,
      resources: opened.map((x) => x.c.address),
      reason: `This applies a plan that opens something new to the internet: ${opened
        .slice(0, 5)
        .map((x) => `${short(x.c.address)} (${x.now.length ? x.now.join(", ") : "a new public address"})`)
        .join(", ")}${opened.length > 5 ? `, and ${opened.length - 5} more` : ""}.`,
    }
  return undefined
}

export interface Blast {
  /** A resource the plan deletes or replaces. */
  resource: string
  action: "delete" | "replace"
  /** What depends on it, directly or through others (data sources left out). */
  dependents: string[]
  /** How many more there are than are listed. */
  more: number
}

const configAddress = (a: string) => a.replace(/\[[^\]]*\]/g, "")

/** E-024: for each resource the plan deletes or replaces, what depends on it in the plan's graph; only those with any. */
export function blastRadius(plan: IacPlan, max = 30): Blast[] {
  if (!plan.graph) return []
  const users = new Map<string, string[]>()
  for (const [r, deps] of Object.entries(plan.graph)) for (const d of deps) users.set(d, [...(users.get(d) ?? []), r])
  const out: Blast[] = []
  for (const c of plan.changes) {
    if (c.action !== "delete" && c.action !== "replace") continue
    const start = plan.graph[c.address] !== undefined || users.has(c.address) ? c.address : configAddress(c.address)
    const found = new Set<string>()
    const queue = [start]
    while (queue.length)
      for (const u of users.get(queue.shift()!) ?? [])
        if (!found.has(u) && u !== start) {
          found.add(u)
          queue.push(u)
        }
    const list = [...found].filter((x) => !x.startsWith("data.") && !/(^|\.)data\./.test(x)).sort()
    if (list.length) out.push({ resource: c.address, action: c.action, dependents: list.slice(0, max), more: Math.max(0, list.length - max) })
  }
  return out.slice(0, 10)
}

/** The tool a command applies a plan with, or undefined when it applies none. */
export function applyTool(command: string): IacTool | undefined {
  const c = ` ${command.replace(/\s+/g, " ")} `
  if (/[\s;&|(](terraform|tofu|terragrunt)(\.exe)?( -chdir=\S+)? apply\b/i.test(c)) return "terraform"
  if (/[\s;&|(]az(\.cmd)? (deployment (group|sub|mg|tenant)|group deployment) create\b/i.test(c) || /\bNew-Az(ResourceGroup|Subscription|ManagementGroup|Tenant)?Deployment\b/i.test(c)) return "arm"
  if (/[\s;&|(]aws(\.exe)? cloudformation (execute-change-set|deploy)\b/i.test(c)) return "cloudformation"
  if (/[\s;&|(]pulumi(\.exe)? (up|update)\b/i.test(c)) return "pulumi"
  return undefined
}
