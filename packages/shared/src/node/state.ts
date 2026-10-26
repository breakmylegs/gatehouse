import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { writeFileAtomic } from "./atomic.js"
import { gatehouseDataDir } from "./paths.js"

/**
 * State that must survive a restart of any Gatehouse process. The kill switch lives here so that an
 * Approver that crashes and restarts while it is engaged comes back still denying everything.
 */
export const GatehouseState = z.object({
  killSwitch: z
    .object({
      engaged: z.boolean(),
      since: z.string().optional(),
      by: z.string().optional(),
      reason: z.string().optional(),
    })
    .default({ engaged: false }),
})
export type GatehouseState = z.infer<typeof GatehouseState>

export function statePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.GATEHOUSE_STATE ?? path.join(gatehouseDataDir(env), "state.json")
}

/**
 * A missing file means "not engaged". A file that exists but cannot be read or understood means the kill
 * switch is treated as ENGAGED, so damage to the state file can never quietly re-arm the system.
 */
export function readState(env: NodeJS.ProcessEnv = process.env): GatehouseState & { damaged?: boolean } {
  const file = statePath(env)
  if (!fs.existsSync(file)) return GatehouseState.parse({})
  try {
    return GatehouseState.parse(JSON.parse(fs.readFileSync(file, "utf8")))
  } catch {
    return { killSwitch: { engaged: true, reason: "state file unreadable" }, damaged: true }
  }
}

export async function writeState(state: GatehouseState, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const file = statePath(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await writeFileAtomic(file, JSON.stringify(GatehouseState.parse(state), null, 2) + "\n")
}
