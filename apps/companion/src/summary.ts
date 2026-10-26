import path from "node:path"
import { findProjectRoot, type Policy, type Rule } from "@gatehouse/policy"

export const SUMMARY_MAX_CHARS = 1500

function list(items: string[] | undefined): string {
  return (items ?? []).join(", ")
}

function describeAllow(rule: Rule, roots: string): string | undefined {
  if (rule.commands) {
    return `Shell commands made only of: ${list(rule.commands)}. Every part of a pipeline or chain must match.`
  }
  if (rule.tools) {
    const where = rule.pathInside === "workspaceRoots" ? ` inside the workspace (${roots})` : ""
    const globs = rule.pathGlobs ? ` limited to ${list(rule.pathGlobs)}` : ""
    const source = rule.mcpSource ? " (the Gatehouse tools only)" : ""
    return `${list(rule.tools)}${where}${globs}${source}.`
  }
  return undefined
}

/**
 * A short, fixed-shape description of what is pre-approved, so an agent can choose commands that will not
 * wait for a person. It takes no arguments and answers no questions about specific commands, so it cannot be
 * used to probe the policy.
 */
export function summarisePolicy(policy: Policy | undefined, cwd: string): string {
  if (!policy) {
    return "No policy is loaded, so every action will wait for a person to approve it."
  }
  const project = path.basename(findProjectRoot(cwd)).toLowerCase()
  const overlay = policy.overlays[project]
  const removed = new Set(overlay?.removeAllow ?? [])
  const roots = policy.rules.workspaceRoots.join(", ")
  const lines: string[] = [
    `Gatehouse policy ${policy.hash.slice(0, 12)}. These run without asking:`,
  ]
  for (const rule of policy.rules.allow) {
    if (removed.has(rule.id)) continue
    const text = describeAllow(rule, roots)
    if (text) lines.push(`- ${text}`)
  }
  const blocked = policy.rules.floor.map((r) => r.message).filter((m): m is string => Boolean(m))
  lines.push(
    "Everything else waits for a person to approve and may take a long time or be refused.",
    "Never available: secrets files (.env, keys, .ssh, .aws), system folders, encoded or obfuscated commands, eval of variables, piping into a shell.",
  )
  if (blocked.length > 0) lines.push(`Policy note: ${blocked[0]}`)
  lines.push(
    "To avoid waiting: keep commands simple. Variables, substitutions, heredocs and output redirection always need approval.",
  )
  if (overlay) lines.push("This project has extra restrictions on top of the above.")
  const text = lines.join("\n")
  return text.length <= SUMMARY_MAX_CHARS ? text : text.slice(0, SUMMARY_MAX_CHARS - 3) + "..."
}

/** Globs of files a checkpoint must never copy: the floor rules that guard secrets (they cover Read). */
export function secretGlobs(policy: Policy): string[] {
  return policy.rules.floor
    .filter((r) => r.pathGlobs && r.tools?.includes("Read"))
    .flatMap((r) => r.pathGlobs ?? [])
}
