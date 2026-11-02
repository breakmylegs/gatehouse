import fs from "node:fs"
import { readState, statePath, writeState, type GatehouseState } from "@gatehouse/shared/node"

export type KillSwitchState = GatehouseState["killSwitch"] & { damaged?: boolean }

/**
 * The deny-all switch. It lives in a file, not in memory, so an Approver that crashes and restarts while
 * the switch is engaged comes back still denying everything. The file is read on each evaluation (cached by
 * its modification time), so a change made by another process takes effect at once. Engaging is easy,
 * re-arming is a deliberate call that only the Host's desktop path makes.
 */
export class KillSwitch {
  readonly #env: NodeJS.ProcessEnv
  #cacheKey = ""
  #cached: KillSwitchState = { engaged: false }

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.#env = env
  }

  get(): KillSwitchState {
    const file = statePath(this.#env)
    let key: string
    try {
      const st = fs.statSync(file)
      key = `${st.mtimeMs}:${st.size}`
    } catch {
      key = "missing"
    }
    if (key === this.#cacheKey) return this.#cached
    const state = readState(this.#env)
    this.#cached = { ...state.killSwitch, ...(state.damaged ? { damaged: true } : {}) }
    this.#cacheKey = key
    return this.#cached
  }

  async set(
    engaged: boolean,
    by: string | undefined,
    reason: string | undefined,
  ): Promise<KillSwitchState> {
    await writeState(
      {
        killSwitch: {
          engaged,
          ...(engaged ? { since: new Date().toISOString() } : {}),
          ...(by !== undefined ? { by } : {}),
          ...(reason !== undefined ? { reason } : {}),
        },
      },
      this.#env,
    )
    this.#cacheKey = ""
    return this.get()
  }
}
