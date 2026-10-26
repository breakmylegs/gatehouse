/** Variables that must never reach an SDK session (invariant 6). */
export const STRIPPED_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const

/** Returns a copy of the environment with credential variables removed. */
export function sanitiseEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env }
  const banned = new Set<string>(STRIPPED_ENV_VARS.map((name) => name.toUpperCase()))
  for (const key of Object.keys(out)) {
    if (banned.has(key.toUpperCase())) delete out[key]
  }
  return out
}
