// Mac fork: Codehouse.app tells its Host where its parts and your rules are through the environment
// (packaging/mac/Host.swift). A session inherits the Host's environment, so without this every command Claude runs
// would carry them too: a Codehouse started from a session would read your real rules, and a test that checks how
// Codehouse runs from its source folder would see the Mac app instead. The Approver still gets them: it is started
// with its own environment (approver-process.ts), never through this. sessions.ts calls it (see docs/mac.md).
export const MAC_APP_ENV = [
  "GATEHOUSE_MAC_APP_VERSION",
  "GATEHOUSE_MAC_LIMITS",
  "GATEHOUSE_LOCAL_RULES",
  "GATEHOUSE_USER_RULES",
  "GATEHOUSE_OVERLAY_DIR",
] as const

/** A session's environment without the Mac app's own settings. */
export function withoutMacAppEnv<T extends Record<string, string | undefined>>(env: T): T {
  const out = { ...env }
  for (const k of MAC_APP_ENV) delete out[k]
  return out
}
