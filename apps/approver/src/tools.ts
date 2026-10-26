import path from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import {
  BUILTIN_RULES,
  findProjectRoot,
  type PolicyEngine,
  type PolicyStore,
  type PwshWorker,
  type Rule,
} from "@gatehouse/policy"
import { Verdict } from "@gatehouse/shared"
import { AuditWriter, type AuditChannel } from "@gatehouse/shared/audit"

export interface ApproverDeps {
  engine: PolicyEngine
  store: PolicyStore
  audit: AuditWriter
  pwsh: PwshWorker | undefined
  /** Used for approval_prompt, where the CLI does not say which folder it runs in. */
  promptCwd: string
  log: (line: string) => void
}

/** Rule ids the Approver (not the policy engine) can put on a verdict. */
const APPROVER_RULES = [
  {
    ruleId: "audit-failure",
    reason: "The audit record could not be written, so the call needs your approval.",
    risk: 50,
  },
]

export const EvaluateContext = z.object({
  cwd: z.string().min(1).max(4096),
  projectRoot: z.string().min(1).max(4096).optional(),
  sessionId: z.string().min(1).max(200),
  toolUseId: z.string().max(200).optional(),
  /** `options.mcpServer.source` from the SDK, for mcp__ tools. */
  mcpSource: z.string().max(100).optional(),
})
export type EvaluateContext = z.infer<typeof EvaluateContext>

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  }
}

/**
 * Evaluates one call and writes its audit record. If the record cannot be written, an allow becomes an
 * escalate (invariants 1 and 13): the Approver never lets an unaudited allow through.
 */
export async function evaluateAndAudit(
  deps: ApproverDeps,
  call: { toolName: string; input: Record<string, unknown> },
  ctx: EvaluateContext,
  event: string,
  channel: AuditChannel = "approver",
): Promise<Verdict> {
  const t0 = performance.now()
  let verdict = await deps.engine.evaluate(call, {
    cwd: ctx.cwd,
    ...(ctx.projectRoot !== undefined ? { projectRoot: ctx.projectRoot } : {}),
    ...(ctx.mcpSource !== undefined ? { mcpSource: ctx.mcpSource } : {}),
  })
  const latencyMs = performance.now() - t0
  try {
    await deps.audit.append({
      session: ctx.sessionId,
      event,
      channel,
      tool: call.toolName,
      ...(ctx.toolUseId !== undefined ? { toolUseId: ctx.toolUseId } : {}),
      cwd: ctx.cwd,
      project: path.basename(ctx.projectRoot ?? findProjectRoot(ctx.cwd)),
      input: call.input,
      verdict,
      latencyMs,
    })
  } catch (e) {
    deps.log(`audit append failed (${(e as NodeJS.ErrnoException).code ?? (e as Error).name})`)
    if (verdict.outcome === "allow") {
      const converted: Verdict = {
        ...verdict,
        outcome: "escalate",
        ruleId: "audit-failure",
        reason: APPROVER_RULES[0]?.reason ?? "The audit record could not be written.",
        risk: 50,
      }
      delete converted.segments
      verdict = converted
    }
  }
  return verdict
}

function findRule(deps: ApproverDeps, ruleId: string) {
  const policy = deps.store.current
  if (policy) {
    for (const section of ["floor", "deny", "escalate", "allow"] as const) {
      const rule = policy.rules[section].find((r) => r.id === ruleId)
      if (rule) return { section, source: "rules", rule }
    }
    for (const [name, overlay] of Object.entries(policy.overlays)) {
      for (const section of ["deny", "escalate"] as const) {
        const rule = (overlay[section] ?? []).find((r) => r.id === ruleId)
        if (rule) return { section, source: `overlay:${name}`, rule }
      }
    }
    const remembered = policy.remember.find((r) => r.id === ruleId)
    if (remembered) return { section: "allow" as const, source: "remember", rule: remembered }
  }
  const builtin = [...BUILTIN_RULES, ...APPROVER_RULES].find((r) => r.ruleId === ruleId)
  if (builtin) return { section: "escalate" as const, source: "built-in", builtin }
  return undefined
}

const SECTION_RATIONALE: Record<string, string> = {
  floor:
    "The floor always denies this. Nothing can override it, not a rule, an overlay or a remember rule.",
  deny: "A deny rule matched. Deny wins over every allow and escalate rule.",
  escalate: "An escalate rule matched, so a person decides.",
  allow: "An allow rule matched and no deny or escalate rule applied.",
}

export function registerApproverTools(server: McpServer, deps: ApproverDeps): void {
  server.registerTool(
    "evaluate_permission",
    {
      title: "Evaluate a permission request",
      description:
        "Decide whether a tool call is allowed, denied or needs a person. Returns a Verdict.",
      inputSchema: {
        toolName: z.string().max(256),
        input: z.record(z.string(), z.unknown()),
        ctx: EvaluateContext,
      },
      outputSchema: Verdict.shape,
    },
    async ({ toolName, input, ctx }) => {
      const verdict = await evaluateAndAudit(deps, { toolName, input }, ctx, "evaluate_permission")
      return {
        structuredContent: verdict,
        content: [{ type: "text" as const, text: JSON.stringify(verdict) }],
      }
    },
  )

  server.registerTool(
    "explain_verdict",
    {
      title: "Explain a rule id",
      description: "Return the rule text and the reason behind a rule id seen in a verdict.",
      inputSchema: { ruleId: z.string().min(1).max(100) },
      outputSchema: {
        found: z.boolean(),
        ruleId: z.string(),
        section: z.string().optional(),
        source: z.string().optional(),
        risk: z.number().optional(),
        rule: z.unknown().optional(),
        rationale: z.string(),
      },
    },
    async ({ ruleId }) => {
      const hit = findRule(deps, ruleId)
      if (!hit) {
        const out = { found: false, ruleId, rationale: "No rule with this id is loaded." }
        return {
          structuredContent: out,
          content: [{ type: "text" as const, text: JSON.stringify(out) }],
        }
      }
      const out =
        "builtin" in hit && hit.builtin
          ? {
              found: true,
              ruleId,
              section: hit.section,
              source: hit.source,
              risk: hit.builtin.risk,
              rationale: `${hit.builtin.reason} This is built into Gatehouse and has no entry in the rules file.`,
            }
          : {
              found: true,
              ruleId,
              section: hit.section,
              source: hit.source,
              ...(hit.rule?.risk !== undefined ? { risk: hit.rule.risk } : {}),
              rule: hit.rule,
              rationale: [(hit.rule as Rule).message ?? "", SECTION_RATIONALE[hit.section]]
                .filter(Boolean)
                .join(" "),
            }
      return {
        structuredContent: out,
        content: [{ type: "text" as const, text: JSON.stringify(out) }],
      }
    },
  )

  server.registerTool(
    "policy_status",
    {
      title: "Policy status",
      description:
        "The loaded policy hash, load errors, overlays, parser state and the audit head.",
      inputSchema: {},
      outputSchema: {
        loaded: z.boolean(),
        hash: z.string().optional(),
        loadedAt: z.string().optional(),
        errors: z.array(z.string()),
        overlays: z.array(z.string()),
        rememberCount: z.number(),
        workspaceRoots: z.array(z.string()),
        pwsh: z.object({ running: z.boolean(), languageMode: z.string().optional() }),
        audit: z.object({
          dir: z.string(),
          seq: z.number().optional(),
          hash: z.string().optional(),
        }),
      },
    },
    async () => {
      const status = deps.store.status()
      const policy = deps.store.current
      let head: ReturnType<AuditWriter["head"]>
      try {
        head = deps.audit.head()
      } catch {
        head = undefined
      }
      const out = {
        loaded: policy !== undefined,
        ...(status.hash !== undefined ? { hash: status.hash } : {}),
        ...(status.loadedAt !== undefined ? { loadedAt: status.loadedAt } : {}),
        errors: status.errors,
        overlays: status.overlays,
        rememberCount: policy?.remember.length ?? 0,
        workspaceRoots: policy?.rules.workspaceRoots ?? [],
        pwsh: {
          running: deps.pwsh?.running ?? false,
          ...(deps.pwsh?.languageMode !== undefined
            ? { languageMode: deps.pwsh.languageMode }
            : {}),
        },
        audit: { dir: deps.audit.dir, ...(head ? { seq: head.seq, hash: head.hash } : {}) },
      }
      return {
        structuredContent: out,
        content: [{ type: "text" as const, text: JSON.stringify(out) }],
      }
    },
  )

  // For headless `claude -p --permission-prompt-tool`. Request and response shapes were verified against
  // the bundled Claude Code (docs/sdk-notes.md): { tool_name, input, tool_use_id } in, a text block holding
  // JSON { behavior: "allow", updatedInput } or { behavior: "deny", message } out.
  server.registerTool(
    "approval_prompt",
    {
      title: "Permission prompt for headless runs",
      description: "Answers Claude Code permission prompts in runs that have no person to ask.",
      inputSchema: {
        tool_name: z.string().max(256),
        input: z.record(z.string(), z.unknown()),
        tool_use_id: z.string().max(200).optional(),
      },
    },
    async ({ tool_name, input, tool_use_id }) => {
      const verdict = await evaluateAndAudit(
        deps,
        { toolName: tool_name, input },
        {
          cwd: deps.promptCwd,
          sessionId: "headless",
          ...(tool_use_id !== undefined ? { toolUseId: tool_use_id } : {}),
        },
        "approval_prompt",
      )
      if (verdict.outcome === "allow") return textResult({ behavior: "allow", updatedInput: input })
      if (verdict.outcome === "deny") {
        return textResult({
          behavior: "deny",
          message: `${verdict.reason} (rule ${verdict.ruleId})`,
        })
      }
      return textResult({
        behavior: "deny",
        message: `This needs a person's approval and this run has no approval channel: ${verdict.reason} (rule ${verdict.ruleId})`,
      })
    },
  )
}
