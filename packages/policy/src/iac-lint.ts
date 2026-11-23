/**
 * E-022 (expansion, Wave E3): infrastructure misconfiguration checks, in process. Terraform (HCL), Bicep, ARM and
 * CloudFormation files are read into one list of resources and checked for public storage, open security groups,
 * missing encryption, weak TLS minimums and missing diagnostics, each finding with its file, line and a fix.
 *
 * Parsers (recorded, as the item asks): the tree-sitter grammars Codehouse ships (VS Code's set, C-031) have none for
 * HCL, Bicep or YAML, so HCL and Bicep are read by a small block reader of its own (blocks, attributes, lists and
 * strings; expressions are kept as their text), ARM by JSON and CloudFormation by JSON or YAML (the yaml package the
 * policy already uses, which reads short-form tags such as !Ref as plain values).
 */
import { parse as parseYaml } from "yaml"
import { exposures } from "./iac-plan.js"

export const IAC_PARSERS = {
  hcl: "Codehouse's own block reader (no tree-sitter grammar for HCL is bundled)",
  bicep: "Codehouse's own block reader (no tree-sitter grammar for Bicep is bundled)",
  arm: "JSON",
  cloudformation: "JSON or YAML (the yaml package)",
} as const

export type IacFormat = keyof typeof IAC_PARSERS

export interface IacResource {
  file: string
  line: number
  format: IacFormat
  type: string
  name: string
  props: Record<string, unknown>
}

export type LintRule = "public-storage" | "open-security-group" | "missing-encryption" | "weak-tls" | "missing-diagnostics"

export interface LintFinding {
  rule: LintRule
  file: string
  line: number
  resource: string
  message: string
  fix: string
}

// ---------- A small reader for HCL and Bicep blocks ----------

class Reader {
  i = 0
  constructor(readonly s: string) {}
  line(at = this.i) {
    let n = 1
    for (let k = 0; k < at && k < this.s.length; k++) if (this.s[k] === "\n") n++
    return n
  }
  skip(newlines = true) {
    for (;;) {
      const c = this.s[this.i]
      if (c === " " || c === "\t" || c === "\r" || (newlines && c === "\n") || (c === "," && newlines)) this.i++
      else if (c === "#" || (c === "/" && this.s[this.i + 1] === "/")) while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++
      else if (c === "/" && this.s[this.i + 1] === "*") {
        const e = this.s.indexOf("*/", this.i + 2)
        this.i = e < 0 ? this.s.length : e + 2
      } else return
    }
  }
  string(): string {
    const q = this.s[this.i]!
    this.i++
    let out = ""
    while (this.i < this.s.length && this.s[this.i] !== q) {
      if (this.s[this.i] === "\\") this.i++
      out += this.s[this.i] ?? ""
      this.i++
    }
    this.i++
    return out
  }
  /** A value: a string, number, true or false, a list, an object, or an expression kept as its text. */
  value(): unknown {
    this.skip(false)
    const c = this.s[this.i]
    if (c === '"' || c === "'") return this.string()
    if (c === "[") {
      this.i++
      const out: unknown[] = []
      for (;;) {
        this.skip()
        if (this.s[this.i] === "]" || this.i >= this.s.length) return this.i++, out
        out.push(this.value())
      }
    }
    if (c === "{") {
      this.i++
      return this.body()
    }
    const start = this.i
    let depth = 0
    while (this.i < this.s.length) {
      const ch = this.s[this.i]!
      if ("([{".includes(ch)) depth++
      else if (")]}".includes(ch)) {
        if (depth === 0) break
        depth--
      } else if ((ch === "\n" || ch === ",") && depth === 0) break
      this.i++
    }
    const raw = this.s.slice(start, this.i).trim()
    return raw === "true" ? true : raw === "false" ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw
  }
  /** An object body up to its closing brace: `key = value`, `key: value` and nested `name { ... }` blocks. */
  body(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (;;) {
      this.skip()
      if (this.i >= this.s.length) return out
      if (this.s[this.i] === "}") return this.i++, out
      const m = /^("[^"]*"|'[^']*'|[\w.-]+)/.exec(this.s.slice(this.i))
      if (!m) {
        this.i++
        continue
      }
      this.i += m[0].length
      const key = m[0].replace(/^["']|["']$/g, "")
      this.skip(false)
      // Labels before a nested block (HCL: dynamic "x" {) are skipped.
      while (this.s[this.i] === '"') {
        this.string()
        this.skip(false)
      }
      const c = this.s[this.i]
      let v: unknown
      if (c === "=" || c === ":") {
        this.i++
        v = this.value()
      } else if (c === "{") {
        this.i++
        v = this.body()
      } else continue
      out[key] = key in out ? [...(Array.isArray(out[key]) && c === "{" ? (out[key] as unknown[]) : [out[key]]), v] : v
    }
  }
}

/** Terraform's resources: `resource "type" "name" { ... }`. */
export function readHcl(file: string, text: string): IacResource[] {
  const out: IacResource[] = []
  for (const m of text.matchAll(/^\s*resource\s+"([\w-]+)"\s+"([\w-]+)"\s*\{/gm)) {
    const r = new Reader(text)
    r.i = m.index! + m[0].length
    out.push({ file, line: r.line(m.index! + m[0].indexOf("resource")), format: "hcl", type: m[1]!, name: m[2]!, props: r.body() })
  }
  return out
}

/** Bicep's resources: `resource sym 'Type@version' = { ... }` (a condition before the brace is passed over). */
export function readBicep(file: string, text: string): IacResource[] {
  const out: IacResource[] = []
  for (const m of text.matchAll(/^\s*resource\s+(\w+)\s+'([^'@]+)@[^']*'(?:\s+existing)?\s*=\s*(?:if\s*\([^)]*\)\s*)?\{/gm)) {
    const r = new Reader(text)
    r.i = m.index! + m[0].length
    out.push({ file, line: r.line(m.index! + m[0].indexOf("resource")), format: "bicep", type: m[2]!, name: m[1]!, props: r.body() })
  }
  return out
}

const lineOf = (text: string, needle: string) => {
  const at = text.indexOf(needle)
  return at < 0 ? 1 : text.slice(0, at).split("\n").length
}

/** An ARM template's resources, child resources included. */
export function readArm(file: string, text: string): IacResource[] {
  let v: { resources?: unknown }
  try {
    v = JSON.parse(text) as { resources?: unknown }
  } catch {
    return []
  }
  const out: IacResource[] = []
  const walk = (list: unknown, parent: string) => {
    if (!Array.isArray(list)) return
    for (const r of list as Array<Record<string, unknown>>) {
      if (!r || typeof r.type !== "string") continue
      const type = r.type.includes("/") && parent && !r.type.startsWith("Microsoft.") ? `${parent}/${r.type}` : r.type
      const name = typeof r.name === "string" ? r.name : ""
      out.push({ file, line: lineOf(text, `"${name}"`), format: "arm", type, name, props: r })
      walk(r.resources, type)
    }
  }
  walk(v.resources, "")
  return out
}

/** A CloudFormation template's resources, from JSON or YAML. */
export function readCloudFormation(file: string, text: string): IacResource[] {
  let v: { Resources?: Record<string, { Type?: string; Properties?: Record<string, unknown> }> } | undefined
  try {
    v = /^\s*\{/.test(text) ? JSON.parse(text) : (parseYaml(text, { logLevel: "silent" }) as typeof v)
  } catch {
    return []
  }
  if (!v?.Resources || typeof v.Resources !== "object") return []
  return Object.entries(v.Resources)
    .filter(([, r]) => r && typeof r.Type === "string")
    .map(([name, r]) => ({ file, line: lineOf(text, `${name}:`) || lineOf(text, `"${name}"`), format: "cloudformation" as const, type: r.Type!, name, props: r.Properties ?? {} }))
}

/** Which reader a file needs, by its name and words; undefined when it is not infrastructure code. */
export function iacFormat(file: string, text: string): IacFormat | undefined {
  if (/\.tf$/i.test(file)) return "hcl"
  if (/\.bicep$/i.test(file)) return "bicep"
  if (/\.json$/i.test(file) && /"\$schema"\s*:\s*"[^"]*deploymentTemplate\.json/i.test(text)) return "arm"
  if (/\.(json|ya?ml|template)$/i.test(file) && /AWSTemplateFormatVersion|"?Resources"?\s*:[\s\S]*"?Type"?\s*:\s*["']?AWS::/.test(text)) return "cloudformation"
  return undefined
}

export function readIac(file: string, text: string): IacResource[] {
  const f = iacFormat(file, text)
  return f === "hcl" ? readHcl(file, text) : f === "bicep" ? readBicep(file, text) : f === "arm" ? readArm(file, text) : f === "cloudformation" ? readCloudFormation(file, text) : []
}

// ---------- The rules ----------

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
/** A setting found anywhere in a resource, by name in any casing or with underscores. */
function setting(props: unknown, name: string): unknown {
  const want = name.toLowerCase().replace(/[-_]/g, "")
  let found: unknown
  const walk = (v: unknown) => {
    if (found !== undefined) return
    if (Array.isArray(v)) return v.forEach(walk)
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k.toLowerCase().replace(/[-_]/g, "") === want && (typeof x !== "object" || x === null)) found = x
        else walk(x)
      }
  }
  walk(props)
  return found
}
const isFalse = (v: unknown) => v === false || v === "false" || v === "False"

const ENCRYPTED: Array<[RegExp, string, string]> = [
  [/^(aws_db_instance|aws_rds_cluster|AWS::RDS::DBInstance|AWS::RDS::DBCluster)$/, "storage_encrypted", "set storage_encrypted (StorageEncrypted) to true, with a KMS key"],
  [/^(aws_ebs_volume|AWS::EC2::Volume)$/, "encrypted", "set encrypted (Encrypted) to true"],
  [/^(aws_efs_file_system|AWS::EFS::FileSystem)$/, "encrypted", "set encrypted (Encrypted) to true"],
  [/^(aws_redshift_cluster|AWS::Redshift::Cluster)$/, "encrypted", "set encrypted (Encrypted) to true"],
]

const WEAK_TLS = /^(tls1_?[01]|1\.[01]|tlsv1(_2016)?|tlsv1\.1(_2016)?|sslv3)$/i
const WEAK_POLICY = /(2016-08|2015-0|TLS-1-0|TLS-1-1|TLSv1\.1|ELBSecurityPolicy-TLS-1-[01])/i

/** Resources a diagnostic setting is expected for, and whether something in the files sends their logs. */
const NEEDS_DIAGNOSTICS = /^(azurerm_key_vault|Microsoft\.KeyVault\/vaults|azurerm_mssql_server|Microsoft\.Sql\/servers|azurerm_storage_account|Microsoft\.Storage\/storageAccounts)$/
const DIAGNOSTIC = /^(azurerm_monitor_diagnostic_setting|Microsoft\.Insights\/diagnosticSettings)$/i

export function lintResources(resources: IacResource[]): LintFinding[] {
  const out: LintFinding[] = []
  const add = (r: IacResource, rule: LintRule, message: string, fix: string) => out.push({ rule, file: r.file, line: r.line, resource: `${r.type} ${r.name}`, message, fix })
  const diagnostics = resources.filter((r) => DIAGNOSTIC.test(r.type)).map((r) => JSON.stringify(r.props))
  for (const r of resources) {
    // Public storage and open security groups, read as E-018 reads a plan.
    for (const e of exposures(r.props)) {
      const range = /^(cidr|ipv6|source|ip_?range|start|cidrip)/i.test(e)
      if (range)
        add(r, "open-security-group", `It lets anyone on the internet in (${e}).`, "allow only the addresses that need it, such as your office range or a load balancer's security group")
      else if (!range) add(r, "public-storage", `It is open to the public (${e}).`, "keep it private and share through signed URLs, a CDN with origin access, or private endpoints")
    }
    if (/^(google_storage_bucket_iam_(member|binding))$/.test(r.type) && /allUsers|allAuthenticatedUsers/.test(JSON.stringify(r.props)))
      add(r, "public-storage", "It gives a bucket to allUsers or allAuthenticatedUsers.", "grant it to the service accounts or groups that need it")
    // Missing encryption: unset or false.
    for (const [type, key, fix] of ENCRYPTED)
      if (type.test(r.type)) {
        const v = setting(r.props, key)
        if (v === undefined || isFalse(v)) add(r, "missing-encryption", `Its data is not encrypted at rest (${key} ${v === undefined ? "is not set" : "is false"}).`, fix)
      }
    if (/^(aws_dynamodb_table|AWS::DynamoDB::Table)$/.test(r.type) && isFalse(setting(r.props, "enabled")) && /server_side_encryption|SSESpecification/i.test(JSON.stringify(r.props)))
      add(r, "missing-encryption", "Its server-side encryption is switched off.", "switch server_side_encryption on, with a customer managed key where required")
    if (/^(azurerm_mssql_database)$/.test(r.type) && isFalse(setting(r.props, "transparent_data_encryption_enabled")))
      add(r, "missing-encryption", "Transparent data encryption is switched off.", "leave transparent_data_encryption_enabled at true")
    // Weak TLS minimums.
    // Each name once: the lookup ignores case and underscores, so min_tls_version covers minTlsVersion.
    for (const key of ["min_tls_version", "minimum_tls_version", "minimum_protocol_version"]) {
      const v = setting(r.props, key)
      if (typeof v === "string" && WEAK_TLS.test(v.trim())) add(r, "weak-tls", `It accepts TLS older than 1.2 (${key} ${v}).`, "set the minimum to TLS 1.2 (TLS1_2, 1.2 or TLSv1.2_2021)")
    }
    {
      const key = "ssl_policy"
      const v = setting(r.props, key)
      if (typeof v === "string" && WEAK_POLICY.test(v)) add(r, "weak-tls", `Its TLS policy allows old versions (${v}).`, "use a TLS 1.2 or 1.3 policy, such as ELBSecurityPolicy-TLS13-1-2-2021-06")
    }
    // Missing diagnostics.
    if (NEEDS_DIAGNOSTICS.test(r.type) && !diagnostics.some((d) => d.includes(r.name) || d.includes(`${r.type}.${r.name}`)))
      add(r, "missing-diagnostics", "Nothing in these files sends its logs anywhere.", "add a diagnostic setting (azurerm_monitor_diagnostic_setting, or Microsoft.Insights/diagnosticSettings scoped to it) to a Log Analytics workspace")
    if (/^(aws_lb|aws_alb)$/.test(r.type) && setting(rec(r.props.access_logs), "enabled") !== true)
      add(r, "missing-diagnostics", "Its access logs are not switched on.", "add an access_logs block with enabled = true and a bucket")
    if (r.type === "AWS::ElasticLoadBalancingV2::LoadBalancer" && !/access_logs\.s3\.enabled[^}]*"?Value"?\s*:\s*"?true/i.test(JSON.stringify(r.props)))
      add(r, "missing-diagnostics", "Its access logs are not switched on.", "set the access_logs.s3.enabled attribute to true, with a bucket")
  }
  return out
}

/** Every finding in a set of files, read by their formats. */
export function lintIac(files: Array<{ file: string; text: string }>): LintFinding[] {
  return lintResources(files.flatMap((f) => readIac(f.file, f.text)))
}
