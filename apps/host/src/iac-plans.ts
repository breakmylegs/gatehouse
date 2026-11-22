/**
 * E-018: the infrastructure plans each session has shown, so an apply inherits the strictest finding of its plan. A plan
 * is taken from what the session's own commands printed (terraform show -json, az deployment what-if --output json,
 * aws cloudformation describe-change-set, pulumi preview --json) and from plan files in its folder written in the last
 * six hours (tfplan.json, plan.json, whatif.json, changeset.json, preview.json and the like). An apply whose plan
 * Codehouse has not seen goes to a person too (decided by me, stricter): there is nothing to judge it by.
 */
import fs from "node:fs"
import { costDelta, type CostDelta, type PriceSheet } from "./price-sheet.js"
import path from "node:path"
import { applyTool, blastRadius, judgePlan, parsePlanText, type Blast, type IacFinding, type IacPlan, type IacTool } from "@gatehouse/policy"

export const IAC_UNSEEN_RULE = "iac-plan-unseen"
export const IAC_UNSEEN_RISK = 75

const PLAN_FILE = /^(tf)?(plan|what-?if|change-?set|preview)[\w.-]*\.json$|\.(tfplan|plan|whatif)\.json$/i
const RECENT_MS = 6 * 3600_000

/** Plan files in a folder and its direct subfolders, written recently. */
export function planFiles(cwd: string, now = Date.now()): string[] {
  const out: string[] = []
  const look = (dir: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isFile() && PLAN_FILE.test(e.name)) {
        try {
          const st = fs.statSync(p)
          if (now - st.mtimeMs < RECENT_MS && st.size < 50 * 1024 * 1024) out.push(p)
        } catch {
          // Gone since it was listed.
        }
      } else if (e.isDirectory() && depth > 0 && !e.name.startsWith(".") && e.name !== "node_modules") look(p, depth - 1)
    }
  }
  look(cwd, 1)
  return out
}

export class IacPlans {
  readonly #seen = new Map<string, Map<IacTool, IacPlan>>()

  /** A command's output: kept as the session's plan for its tool when it is one. */
  seen(sessionId: string, output: string): void {
    if (!output.includes("{")) return
    const plan = parsePlanText(output.slice(0, 50 * 1024 * 1024))
    if (!plan) return
    const m = this.#seen.get(sessionId) ?? new Map<IacTool, IacPlan>()
    m.set(plan.tool, plan)
    this.#seen.set(sessionId, m)
  }

  /** The plans an apply by this tool may be applying: the session's own, and recent plan files. */
  plansFor(sessionId: string, tool: IacTool, cwd: string): IacPlan[] {
    const plans: IacPlan[] = []
    const own = this.#seen.get(sessionId)?.get(tool)
    if (own) plans.push(own)
    for (const f of planFiles(cwd)) {
      try {
        const p = parsePlanText(fs.readFileSync(f, "utf8"))
        if (p?.tool === tool) plans.push(p)
      } catch {
        // Unreadable: not a plan.
      }
    }
    return plans
  }

  /**
   * What an apply command meets: the strictest finding of its plans, a hold when no plan was seen, or undefined when
   * the command applies nothing or its plans are clean.
   */
  forCommand(sessionId: string, command: string, cwd: string): (IacFinding & { plans: IacPlan[] }) | { ruleId: typeof IAC_UNSEEN_RULE; risk: number; reason: string; resources: string[]; plans: IacPlan[] } | undefined {
    const tool = applyTool(command)
    if (!tool) return undefined
    const plans = this.plansFor(sessionId, tool, cwd)
    if (!plans.length)
      return { ruleId: IAC_UNSEEN_RULE, risk: IAC_UNSEEN_RISK, resources: [], plans, reason: `This applies infrastructure changes, and Codehouse has not seen the plan, so it cannot say what would be deleted or opened. Show the plan as JSON first (${SHOW[tool]}).` }
    const found = plans.map(judgePlan).filter((f): f is IacFinding => !!f).sort((a, b) => b.risk - a.risk)[0]
    return found ? { ...found, plans } : undefined
  }

  /** E-024: what depends on what an apply's plans delete or replace, for its card. */
  blastFor(sessionId: string, command: string, cwd: string): Blast[] {
    const tool = applyTool(command)
    if (!tool) return []
    const seen = new Set<string>()
    return this.plansFor(sessionId, tool, cwd)
      .flatMap((p) => blastRadius(p))
      .filter((b) => (seen.has(b.resource) ? false : (seen.add(b.resource), true)))
      .slice(0, 10)
  }

  /** E-019: the monthly change an apply's plans make, priced from a signed sheet. */
  costFor(sessionId: string, command: string, cwd: string, sheet: PriceSheet | undefined): CostDelta | undefined {
    const tool = applyTool(command)
    if (!tool || !sheet) return undefined
    return costDelta(this.plansFor(sessionId, tool, cwd), sheet)
  }

  forget(sessionId: string): void {
    this.#seen.delete(sessionId)
  }
}

const SHOW: Record<IacTool, string> = {
  terraform: "terraform show -json tfplan",
  arm: "az deployment group what-if --output json",
  cloudformation: "aws cloudformation describe-change-set",
  pulumi: "pulumi preview --json",
}

/** A Bash or PowerShell result's printed text. */
export function outputText(response: unknown): string {
  if (typeof response === "string") return response
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>
    return [r.stdout, r.output, r.content].filter((x): x is string => typeof x === "string").join("\n")
  }
  return ""
}
