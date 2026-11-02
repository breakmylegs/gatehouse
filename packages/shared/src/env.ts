/**
 * Variables that must never reach an SDK session: the credentials (invariant 6), and the one that loads extra plugin
 * folders into a session, which could bring in a mod that lets tool calls run without the Approver (B03, invariant 2).
 */
export const STRIPPED_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_PLUGIN_DIRS",
] as const

/** Returns a copy of the environment with those variables removed. */
export function sanitiseEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env }
  const banned = new Set<string>(STRIPPED_ENV_VARS.map((name) => name.toUpperCase()))
  for (const key of Object.keys(out)) {
    if (banned.has(key.toUpperCase())) delete out[key]
  }
  return out
}
