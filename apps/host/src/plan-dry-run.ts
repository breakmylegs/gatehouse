/**
 * C-012, the policy dry run (Frontier build, Wave 2 prerequisite). When Claude asks to leave Plan mode, the plan's
 * steps are read for the calls they name (shell commands in its code blocks or in backticks, and the files it says it
 * will change), and each is judged by the live policy as it stands, with nothing run and nothing recorded as a
 * decision. The plan's card then says how many would be allowed, would ask you and would be refused. It is an
 * estimate: what Claude runs once the plan is approved may differ, and every call is still judged when it is made.
 */
import type { PolicyEngine, ToolCall } from "@gatehouse/policy"

export interface PlanEstimate {
  allow: number
  escalate: number
  deny: number
  calls: Array<{ tool: string; text: string; outcome: string; ruleId: string }>
}

const SHELL_LANGS = /^(bash|sh|shell|zsh|console|terminal|cmd|bat|powershell|pwsh|ps1|ps)?$/i
const PS_LANGS = /^(powershell|pwsh|ps1|ps)$/i
/** Words a command in prose starts with, so `npm test` counts and `UserService` does not. */
const COMMANDS =
  /^(npm|npx|pnpm|yarn|bun|node|deno|git|gh|dotnet|nuget|pip|pip3|python|python3|py|uv|poetry|cargo|go|make|cmake|docker|kubectl|az|aws|terraform|winget|choco|scoop|curl|wget|rm|del|rmdir|mv|cp|mkdir|cat|sed|chmod|tsc|vitest|jest|pytest|eslint|prettier|Remove-Item|Set-Content|Copy-Item|Move-Item|New-Item|Invoke-WebRequest|Start-Process)\b/
const MAX_CALLS = 50

/** The calls a plan names: commands in shell code blocks and in backticks, and the files it says it will change. */
export function planCalls(plan: string): ToolCall[] {
  const out: ToolCall[] = []
  const seen = new Set<string>()
  const add = (c: ToolCall) => {
    const key = JSON.stringify(c)
    if (seen.has(key) || out.length >= MAX_CALLS) return
    seen.add(key)
    out.push(c)
  }
  const line = (l: string) =>
    l
      .trim()
      .replace(/^(\$|>|PS[^>]*>)\s+/, "")
      .trim()
  // Fenced blocks: a shell language, or none when the line reads as a command.
  for (const m of plan.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    const lang = (m[1] ?? "").trim()
    if (!SHELL_LANGS.test(lang)) continue
    const tool = PS_LANGS.test(lang) ? "PowerShell" : "Bash"
    for (const raw of (m[2] ?? "").split("\n")) {
      const l = line(raw)
      if (!l || /^(#|\/\/|rem\b|::)/i.test(l)) continue
      if (!lang && !COMMANDS.test(l)) continue
      add({ toolName: tool, input: { command: l } })
    }
  }
  const prose = plan.replace(/```[\s\S]*?```/g, "")
  // Commands in backticks in the prose.
  for (const m of prose.matchAll(/`([^`\n]{2,300})`/g)) {
    const l = line(m[1] ?? "")
    if (COMMANDS.test(l) && /\s/.test(l)) add({ toolName: "Bash", input: { command: l } })
  }
  // Files it says it will change or create: a backticked path after a verb on the same line.
  for (const l of prose.split("\n")) {
    const verb = /\b(create|add|write|new)\b/i.test(l) ? "Write" : /\b(edit|change|update|modify|rewrite|fix|refactor|rename|replace)\b/i.test(l) ? "Edit" : undefined
    if (!verb) continue
    for (const m of l.matchAll(/`([^`\s]+\.[A-Za-z0-9]{1,8})`/g)) {
      const file = m[1]!
      if (COMMANDS.test(file)) continue
      add(verb === "Write" ? { toolName: "Write", input: { file_path: file, content: "" } } : { toolName: "Edit", input: { file_path: file, old_string: "", new_string: "" } })
    }
  }
  return out
}

/** Each call the plan names, judged by the live policy. Nothing is run, and nothing is written to the audit log. */
export async function dryRunPlan(plan: string, cwd: string, engine: Pick<PolicyEngine, "evaluate">): Promise<PlanEstimate> {
  const est: PlanEstimate = { allow: 0, escalate: 0, deny: 0, calls: [] }
  for (const call of planCalls(plan)) {
    const v = await engine.evaluate(call, { cwd })
    est[v.outcome]++
    const i = call.input as Record<string, unknown>
    est.calls.push({ tool: call.toolName, text: String(i.command ?? i.file_path ?? ""), outcome: v.outcome, ruleId: v.ruleId })
  }
  return est
}

/** The estimate in words, for the plan's card. Empty when the plan names no call. */
export function estimateWords(e: PlanEstimate): string {
  const n = e.allow + e.escalate + e.deny
  if (!n) return ""
  return `An estimate, from the ${n} step${n === 1 ? "" : "s"} the plan names, against your rules now: ${e.allow} would be allowed, ${e.escalate} would ask you, ${e.deny} would be refused. What Claude runs may differ, and each call is still judged when it is made.`
}
