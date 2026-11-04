import os from "node:os"
import path from "node:path"

/** Where Gatehouse keeps config, state and audit on this machine. */
export function gatehouseDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GATEHOUSE_DATA_DIR) return env.GATEHOUSE_DATA_DIR
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share")
  return path.join(base, "Gatehouse")
}

/**
 * B37: where IT keeps a signed policy for this computer: %ProgramData%\\Codehouse\\managed, which only an administrator
 * can change. GATEHOUSE_MANAGED_DIR replaces it (tests).
 */
export function managedPolicyDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GATEHOUSE_MANAGED_DIR) return env.GATEHOUSE_MANAGED_DIR
  return path.join(env.ProgramData ?? env.PROGRAMDATA ?? "C:\\ProgramData", "Codehouse", "managed")
}

export function auditDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.GATEHOUSE_AUDIT_DIR ?? path.join(gatehouseDataDir(env), "audit")
}
