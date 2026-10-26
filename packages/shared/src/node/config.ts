import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { gatehouseDataDir } from "./paths.js"

/** Settings the laptop-side processes read. The settings screen writes this file in a later phase. */
export const GatehouseConfig = z
  .object({
    /** Client names, internal host names and the like, redacted everywhere (invariant 12). */
    redactTerms: z.array(z.string()).default([]),
    /** The organisation the signed-in account must belong to (invariant 14). */
    expectedOrg: z.string().optional(),
    /** Overrides the default rules file. */
    rulesPath: z.string().optional(),
  })
  .strict()
export type GatehouseConfig = z.infer<typeof GatehouseConfig>

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.GATEHOUSE_CONFIG ?? path.join(gatehouseDataDir(env), "config.json")
}

/** A missing file gives the defaults. A present but invalid file throws, it is never ignored. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatehouseConfig {
  const file = configPath(env)
  if (!fs.existsSync(file)) return GatehouseConfig.parse({})
  return GatehouseConfig.parse(JSON.parse(fs.readFileSync(file, "utf8")))
}
