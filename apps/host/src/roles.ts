/**
 * E-046, role-based agent teams (Expansion E4). `.codehouse/roles.yml` defines roles (planner, implementer, tester,
 * reviewer, documenter, or the project's own), each with a model, an effort, path scopes and tool limits. Each role
 * runs as its own session in its own worktree; hand-offs use E-052's structured results.
 *
 * Following section 10, a role is an overlay that can only restrict: an edit outside the role's paths goes to a person,
 * a tool the role may not use is denied, and a read-only role's edits are denied. A role definition that tries to add
 * an allow (allow lists, auto-approval, a looser permission mode, rules) is refused as a whole, never partly used.
 *
 *   roles:
 *     tester:
 *       model: claude-sonnet-5-5
 *       effort: medium
 *       paths: ["test/**", "tests/**", "**\/*.test.ts"]
 *       denyTools: [WebFetch]
 */
import fs from "node:fs"
import path from "node:path"
import { compileGlobs, parseYaml } from "@gatehouse/policy"

export const ROLE_SCOPE_RULE = "role-scope"
export const ROLE_TOOL_RULE = "role-tool"

export interface Role {
  name: string
  model?: string
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  /** Where it may edit; edits elsewhere go to a person. Absent: anywhere the rules allow. */
  paths?: string[]
  /** Tools it may not use at all. */
  denyTools?: string[]
  /** It edits nothing. */
  readOnly?: boolean
}

/** Keys that would widen what a role may do; any of them refuses the file. */
const WIDENING = /^(allow|allows|allowTools|allowedTools|allowPaths|autoApprove|autoAllow|approve|rules|permissionMode|mode|bypass\w*|extreme\w*|dangerously\w*|skipPermissions|trust\w*)$/i
const KNOWN = new Set(["model", "effort", "paths", "denyTools", "readOnly", "description"])
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"])

/** The roles a file defines, or why the file is refused. */
export function parseRoles(text: string): { roles: Role[] } | { refused: string } {
  let v: unknown
  try {
    v = parseYaml(text)
  } catch {
    return { refused: "roles.yml is not valid YAML" }
  }
  const roles = (v as { roles?: unknown })?.roles
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) return { refused: "roles.yml has no roles" }
  const out: Role[] = []
  for (const [name, raw] of Object.entries(roles as Record<string, unknown>)) {
    if (!/^[\w-]{1,40}$/.test(name)) return { refused: `the role name ${JSON.stringify(name)} is not a plain name` }
    const r = (raw ?? {}) as Record<string, unknown>
    for (const k of Object.keys(r)) {
      if (WIDENING.test(k)) return { refused: `the role ${name} sets ${k}, which would add an allow; roles can only restrict` }
      if (!KNOWN.has(k)) return { refused: `the role ${name} sets ${k}, which Codehouse does not know` }
    }
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 50) : undefined)
    if (r.effort !== undefined && !EFFORTS.has(String(r.effort))) return { refused: `the role ${name} has an effort Codehouse does not know` }
    out.push({
      name,
      ...(typeof r.model === "string" && r.model.trim() ? { model: r.model.trim() } : {}),
      ...(r.effort !== undefined ? { effort: r.effort as Role["effort"] } : {}),
      ...(list(r.paths)?.length ? { paths: list(r.paths)! } : {}),
      ...(list(r.denyTools)?.length ? { denyTools: list(r.denyTools)! } : {}),
      ...(r.readOnly === true ? { readOnly: true } : {}),
    })
  }
  return { roles: out }
}

export function readRoles(root: string): { roles: Role[] } | { refused: string } {
  try {
    return parseRoles(fs.readFileSync(path.join(root, ".codehouse", "roles.yml"), "utf8"))
  } catch {
    return { roles: [] }
  }
}

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

/**
 * What a role's overlay does to a call: undefined (no change), a hold (an edit outside its paths) or a refusal (a tool
 * it may not use, or any edit by a read-only role). It never allows.
 */
export function roleOverlay(role: Role, toolName: string, input: Record<string, unknown>, root: string, cwd: string): { outcome: "escalate" | "deny"; ruleId: string; reason: string } | undefined {
  const tool = toolName.toLowerCase()
  if (role.denyTools?.some((t) => t.toLowerCase() === tool || (t.endsWith("*") && tool.startsWith(t.slice(0, -1).toLowerCase()))))
    return { outcome: "deny", ruleId: ROLE_TOOL_RULE, reason: `The ${role.name} role may not use ${toolName}.` }
  if (!EDIT_TOOLS.has(toolName)) return undefined
  if (role.readOnly) return { outcome: "deny", ruleId: ROLE_TOOL_RULE, reason: `The ${role.name} role is read-only, so it changes no file.` }
  if (!role.paths?.length) return undefined
  const file = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : ""
  const rel = path.relative(root, path.resolve(cwd, file)).replace(/\\/g, "/")
  if (!rel.startsWith("..") && compileGlobs(role.paths)(rel)) return undefined
  return { outcome: "escalate", ruleId: ROLE_SCOPE_RULE, reason: `The ${role.name} role works in ${role.paths.join(", ")}; ${rel} is outside that, so it waits for you.` }
}

/** What a role's session is told. */
export function rolePrompt(role: Role, task: string): string {
  return [
    `You are the ${role.name} on this team. Keep to that role.`,
    role.readOnly ? "You change no file." : role.paths?.length ? `You work only in: ${role.paths.join(", ")}. Edits elsewhere wait for a person.` : "",
    `Your task: ${task.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}
