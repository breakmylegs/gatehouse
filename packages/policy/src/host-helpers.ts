import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { analyse, FILE_TOOLS, SHELL_TOOLS } from "./analyse.js"
import type { PolicyEngine } from "./engine.js"
import { checkFloor, type FloorHit } from "./floor.js"
import { checkRememberFile } from "./schema.js"
import type { PwshWorker } from "./pwsh.js"
import type { EvalContext, Policy, RememberEntry, ToolCall } from "./types.js"

/**
 * The floor alone, for the Host's PreToolUse hook. The hook is the only place that sees every call (Claude
 * Code approves some calls by itself and they never reach canUseTool), and it must keep working when the
 * Approver is down, so the Host runs the floor in its own process. Returns a deny or null, never an allow.
 */
export async function evaluateFloor(
  policy: Policy | undefined,
  call: ToolCall,
  ctx: EvalContext,
  pwsh?: PwshWorker,
): Promise<FloorHit | null> {
  if (!policy) return null
  const features = await analyse(call, ctx, { pwsh })
  return checkFloor(features, ctx, policy.rules.floor)
}

/**
 * Globs of files a checkpoint must never copy: the floor rules that guard secrets (they cover Read).
 * One source of truth, so the checkpoint and the floor cannot drift apart.
 */
export function secretGlobs(policy: Policy): string[] {
  return policy.rules.floor
    .filter((r) => r.pathGlobs && r.tools?.includes("Read"))
    .flatMap((r) => r.pathGlobs ?? [])
}

export interface RememberCandidate {
  tool: string
  command?: string
  path?: string
}

export type RememberCheck =
  | { ok: true; candidate: RememberCandidate; preview: string }
  | { ok: false; reason: string }

/** Escalations that are built in and that a remember rule cannot lift. */
const STRUCTURAL = new Set([
  "parse-error",
  "pwsh-unavailable",
  "malformed-input",
  "bash-heredoc",
  "bash-eval",
  "dynamic-segment",
  "shell-redirect-write",
  "shell-obfuscation",
  "pwsh-start-process",
  "pwsh-scriptblock-create",
  "pwsh-add-type",
  "pwsh-download-string",
  "pwsh-registry-write",
  "pwsh-execution-policy",
  "engine-error",
  "policy-unavailable",
])

/**
 * Decides whether a call can be turned into a remember rule, and what that rule would be. A remember rule
 * is one exact command or one exact path. It is refused for anything the floor or a deny rule covers, for
 * anything with a variable, substitution or redirect, for chains, and for built-in escalations, because
 * the engine would never apply such a rule anyway and the user must not be told it will.
 */
export async function checkRemember(
  engine: PolicyEngine,
  policy: Policy | undefined,
  call: ToolCall,
  ctx: EvalContext,
  pwsh?: PwshWorker,
): Promise<RememberCheck> {
  if (!policy) return { ok: false, reason: "No policy is loaded." }
  const features = await analyse(call, ctx, { pwsh })
  if (features.malformed) return { ok: false, reason: "The tool input is not in the shape the policy needs." }
  if (features.parseError || features.unavailable) {
    return { ok: false, reason: "The command could not be parsed, so it cannot be remembered." }
  }
  const verdict = await engine.evaluate(call, ctx)
  if (verdict.outcome === "deny") {
    return { ok: false, reason: `Rule ${verdict.ruleId} denies this, and nothing can override a deny.` }
  }
  if (verdict.outcome === "allow") {
    return { ok: false, reason: "This is already allowed, so there is nothing to remember." }
  }
  if (STRUCTURAL.has(verdict.ruleId)) {
    return { ok: false, reason: `Rule ${verdict.ruleId} is built in and a remember rule cannot lift it.` }
  }

  if (SHELL_TOOLS.has(call.toolName)) {
    if (features.segments.length !== 1) {
      return { ok: false, reason: "Only a single command can be remembered, not a chain or pipeline." }
    }
    const seg = features.segments[0]
    if (!seg || seg.dynamic || seg.writes || seg.text === "") {
      return { ok: false, reason: "A command with a variable, substitution or redirect cannot be remembered." }
    }
    return {
      ok: true,
      candidate: { tool: call.toolName, command: seg.text },
      preview: `Allow ${call.toolName} to run exactly: ${seg.text}`,
    }
  }
  if (FILE_TOOLS.has(call.toolName) && call.toolName !== "Grep" && call.toolName !== "Glob") {
    const target = features.targets[0]
    if (features.targets.length !== 1 || !target) {
      return { ok: false, reason: "Only a single file path can be remembered." }
    }
    if (target.unc || target.device || !/^[a-zA-Z]:[\\/]/.test(target.abs)) {
      return { ok: false, reason: "Only a local path on a drive can be remembered." }
    }
    return {
      ok: true,
      candidate: { tool: call.toolName, path: target.abs },
      preview: `Allow ${call.toolName} on exactly this file: ${target.abs}`,
    }
  }
  return { ok: false, reason: `${call.toolName} calls cannot be remembered.` }
}

function entryKey(e: Pick<RememberEntry, "tool" | "command" | "path">): string {
  return `${e.tool}|${e.command ?? ""}|${(e.path ?? "").toLowerCase()}`
}

/**
 * Adds a remember rule to rules.local.yaml (only the desktop does this). Writes the file atomically,
 * re-validates the result before it replaces the old file, and returns the id of a rule that already
 * says the same thing rather than adding a duplicate.
 */
export async function appendRemember(
  localPath: string,
  candidate: RememberCandidate,
  now: () => Date = () => new Date(),
): Promise<{ id: string; added: boolean }> {
  let entries: RememberEntry[] = []
  if (fs.existsSync(localPath)) {
    const checked = checkRememberFile(parseYaml(fs.readFileSync(localPath, "utf8")))
    if (!checked.ok) throw new Error(`rules.local.yaml is not valid: ${checked.errors.join("; ")}`)
    entries = checked.value.remember
  }
  const existing = entries.find((e) => entryKey(e) === entryKey(candidate))
  if (existing) return { id: `remember-${existing.id}`, added: false }
  const id = `r${now().getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const entry: RememberEntry = { id, ...candidate, createdAt: now().toISOString() }
  const next = { version: 1 as const, remember: [...entries, entry] }
  if (!checkRememberFile(next).ok) throw new Error("The new remember rule is not valid")
  fs.mkdirSync(path.dirname(localPath), { recursive: true })
  await writeFileAtomic(localPath, stringifyYaml(next))
  return { id: `remember-${id}`, added: true }
}

/** Removes one remember rule from rules.local.yaml (only the desktop does this). Accepts the id with or without the `remember-` prefix. */
export async function removeRemember(localPath: string, id: string): Promise<{ removed: boolean }> {
  if (!fs.existsSync(localPath)) return { removed: false }
  const checked = checkRememberFile(parseYaml(fs.readFileSync(localPath, "utf8")))
  if (!checked.ok) throw new Error(`rules.local.yaml is not valid: ${checked.errors.join("; ")}`)
  const bare = id.replace(/^remember-/, "")
  const kept = checked.value.remember.filter((e) => e.id !== bare)
  if (kept.length === checked.value.remember.length) return { removed: false }
  await writeFileAtomic(localPath, stringifyYaml({ version: 1 as const, remember: kept }))
  return { removed: true }
}
