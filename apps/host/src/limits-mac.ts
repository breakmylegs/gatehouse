import fs from "node:fs"
import path from "node:path"

// Mac fork: the resource limits per session on a Mac. Codehouse.app carries codehouse-limits
// (packaging/mac/limits/main.swift), which takes the same arguments as Codehouse-Limits.exe, and says where it is in
// GATEHOUSE_MAC_LIMITS (packaging/mac/Host.swift). From the source folder there is none, so sessions run without
// limits there, as before. limits.ts and codehouse-action.ts call these (see docs/mac.md).

/** codehouse-limits, when Codehouse.app gave one: an absolute path to a program that is there. */
export function findLimitsMac(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const exe = env.GATEHOUSE_MAC_LIMITS
  if (!exe || !path.isAbsolute(exe)) return undefined
  try {
    fs.accessSync(exe, fs.constants.X_OK)
    return fs.statSync(exe).isFile() ? exe : undefined
  } catch {
    return undefined
  }
}

/** How the limits helper runs one of Codehouse's own commands on a Mac: through sh, where Windows uses cmd.exe. */
export function macActionShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] | undefined {
  return platform === "darwin" ? ["/bin/sh", "-c", command] : undefined
}
