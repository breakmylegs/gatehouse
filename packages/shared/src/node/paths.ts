import os from "node:os"
import path from "node:path"

/** Where Gatehouse keeps config, state and audit on this machine. */
export function gatehouseDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GATEHOUSE_DATA_DIR) return env.GATEHOUSE_DATA_DIR
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share")
  return path.join(base, "Gatehouse")
}

export function auditDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.GATEHOUSE_AUDIT_DIR ?? path.join(gatehouseDataDir(env), "audit")
}
