import { EventEmitter } from "node:events"
import { readState, writeState } from "@gatehouse/shared/node"
import type { Verdict } from "@gatehouse/shared"
import type { Broker } from "./broker.js"
import type { HostAudit } from "./hostaudit.js"

export interface KillSwitchDeps {
  broker: Broker
  audit: HostAudit
  /** Tells the Approver to deny everything (or to stop). Resolves true when it confirmed. */
  approver: { setKillSwitch(engaged: boolean, by?: string, reason?: string): Promise<boolean> }
  /** Interrupts every running session. */
  interruptAll: () => Promise<void>
  env?: NodeJS.ProcessEnv
  log: (line: string) => void
}

export type KillSource = "desktop" | "phone"

export interface KillStatus {
  engaged: boolean
  since?: string
  by?: string
  reason?: string
  /** True when the Approver confirmed the same state. If false, the Host's own flag is still denying. */
  approverConfirmed: boolean
}

const KILL_VERDICT: Verdict = {
  outcome: "deny",
  ruleId: "kill-switch",
  reason: "The kill switch was engaged.",
  risk: 100,
  decidedBy: "rules",
  policyHash: "none",
}

/**
 * The kill switch, Host side. Engaging it is immediate and cannot fail halfway: the Host's own flag is set
 * first (so canUseTool and the floor hook deny at once), then the state is saved, the sessions are
 * interrupted, every waiting request is cancelled, and the Approver is told to deny everything. It stays
 * engaged across restarts until it is re-armed on the desktop. Phones can engage it but never re-arm it.
 */
export class HostKillSwitch extends EventEmitter<{ changed: [KillStatus] }> {
  readonly #deps: KillSwitchDeps
  #status: KillStatus

  constructor(deps: KillSwitchDeps) {
    super()
    this.#deps = deps
    const saved = readState(deps.env ?? process.env).killSwitch
    this.#status = { ...saved, approverConfirmed: false }
  }

  isEngaged(): boolean {
    return this.#status.engaged
  }

  status(): KillStatus {
    return { ...this.#status }
  }

  /** At start-up: if the switch was left engaged, make sure the Approver is denying too. */
  async syncApprover(): Promise<void> {
    if (!this.#status.engaged) return
    this.#status.approverConfirmed = await this.#deps.approver.setKillSwitch(true, this.#status.by, this.#status.reason)
    this.emit("changed", this.status())
  }

  async engage(by: KillSource, reason = "Kill switch"): Promise<KillStatus> {
    const since = new Date().toISOString()
    this.#status = { engaged: true, since, by, reason, approverConfirmed: false }
    this.emit("changed", this.status())
    // Everything below happens even if one step fails.
    const steps: Promise<unknown>[] = [
      writeState({ killSwitch: { engaged: true, since, by, reason } }, this.#deps.env ?? process.env).catch((e) =>
        this.#deps.log(`kill switch state not saved (${(e as Error).message})`),
      ),
      this.#deps.interruptAll().catch((e) => this.#deps.log(`interrupt failed (${(e as Error).message})`)),
      this.#deps.approver.setKillSwitch(true, by, reason).then((ok) => {
        this.#status.approverConfirmed = ok
      }),
    ]
    this.#deps.broker.cancelAll("The kill switch was engaged")
    await Promise.allSettled(steps)
    await this.#deps.audit.record({
      session: "host",
      event: "kill_switch_engaged",
      channel: by,
      tool: "kill_switch",
      input: { by, reason },
      verdict: { ...KILL_VERDICT, reason: `Kill switch engaged from the ${by}.` },
      latencyMs: 0,
    })
    this.emit("changed", this.status())
    return this.status()
  }

  /** Re-arming is a desktop action only. */
  async rearm(by: KillSource): Promise<KillStatus> {
    if (by !== "desktop") throw new Error("The kill switch can only be re-armed on the desktop")
    const confirmed = await this.#deps.approver.setKillSwitch(false, by)
    await writeState({ killSwitch: { engaged: false, by } }, this.#deps.env ?? process.env)
    this.#status = { engaged: false, by, approverConfirmed: confirmed }
    await this.#deps.audit.record({
      session: "host",
      event: "kill_switch_rearmed",
      channel: "desktop",
      tool: "kill_switch",
      input: { by },
      verdict: { ...KILL_VERDICT, outcome: "allow", ruleId: "kill-switch-rearm", reason: "Kill switch re-armed on the desktop.", risk: 0 },
      latencyMs: 0,
    })
    this.emit("changed", this.status())
    return this.status()
  }
}
