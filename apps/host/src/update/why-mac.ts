// Mac fork: what Settings, Updates says in Codehouse.app on a Mac. The app sets GATEHOUSE_MAC_APP_VERSION
// (packaging/mac/Host.swift). Its copy is signed as a whole, so it never builds a new version beside itself the way
// the Windows install does; a newer Codehouse.app replaces it (docs/mac.md).
export function macAppWhy(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!env.GATEHOUSE_MAC_APP_VERSION) return undefined
  return "Codehouse on a Mac does not update itself yet. Install a newer Codehouse.app over this one: your sessions, settings and rules are kept."
}
