/**
 * C-013: how often each remembered rule with a use limit has allowed a call. The policy carries the limit
 * (`maxUses`, from rules.local.meta.json); the Host counts, once per tool call, wherever the call is decided, and
 * keeps the counts in its data folder (written atomically, read tolerantly). When a grant has none left, the call
 * asks as it would without it. A counts file that exists but cannot be read counts every limited grant as used up
 * (fail closed).
 */
import fs from "node:fs"
import path from "node:path"
import type { Policy } from "@gatehouse/policy"
import type { Verdict } from "@gatehouse/shared"
import { writeFileAtomic } from "@gatehouse/shared/node"

export class GrantUses {
  readonly #file: string
  readonly #policy: () => Policy | undefined
  #uses: Record<string, number> = {}
  #broken = false
  /** What each tool call was told, so a call decided in the hook and again in canUseTool counts once. */
  readonly #byCall = new Map<string, boolean>()

  constructor(file: string, policy: () => Policy | undefined) {
    this.#file = file
    this.#policy = policy
    if (!fs.existsSync(file)) return
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { uses?: unknown }
      if (raw.uses && typeof raw.uses === "object") this.#uses = raw.uses as Record<string, number>
    } catch {
      this.#broken = true
    }
  }

  /**
   * For an allow by a remembered rule with a use limit: counts this call's use and says whether the grant was already
   * used up (true: ask instead). Any other verdict is not counted and never spent.
   */
  spent(verdict: Pick<Verdict, "outcome" | "ruleId">, toolUseId: string): boolean {
    if (verdict.outcome !== "allow" || !verdict.ruleId.startsWith("remember-")) return false
    const rule = this.#policy()?.remember.find((r) => r.id === verdict.ruleId)
    if (rule?.maxUses === undefined) return false
    const seen = this.#byCall.get(toolUseId)
    if (seen !== undefined) return seen
    const used = this.#uses[verdict.ruleId] ?? 0
    const out = this.#broken || used >= rule.maxUses
    this.#byCall.set(toolUseId, out)
    if (this.#byCall.size > 5000) this.#byCall.delete(this.#byCall.keys().next().value as string)
    if (!out) {
      this.#uses[verdict.ruleId] = used + 1
      void this.#save()
    }
    return out
  }

  /** The reason a used-up grant gives when the call asks instead. */
  reason(ruleId: string): string {
    return SPENT_REASON(ruleId, this.#policy()?.remember.find((r) => r.id === ruleId)?.maxUses ?? 0)
  }

  /** How many times a grant has allowed. */
  used(ruleId: string): number {
    return this.#uses[ruleId] ?? 0
  }

  async #save(): Promise<void> {
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true })
      await writeFileAtomic(
        this.#file,
        JSON.stringify({ version: 1, uses: this.#uses }, null, 2) + "\n",
      )
    } catch {
      // kept in memory; the next save tries again
    }
  }
}

/** The reason a used-up grant gives when the call asks instead. */
export const SPENT_REASON = (ruleId: string, max: number) =>
  `The remembered rule ${ruleId} has allowed its ${max === 1 ? "one use" : `${max} uses`}, so this asks you again.`
