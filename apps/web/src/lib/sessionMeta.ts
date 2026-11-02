/**
 * What a session told us about itself when it started: its slash commands, skills, connectors (MCP servers) and
 * plugins. Read defensively from the SDK's init message; anything unexpected is simply left out.
 */
export interface SessionMeta {
  slashCommands: string[]
  skills: string[]
  connectors: Array<{ name: string; status: string }>
  plugins: Array<{ name: string; version?: string }>
  model?: string
  version?: string
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []

export function readInit(message: unknown): SessionMeta | undefined {
  if (!message || typeof message !== "object") return undefined
  const m = message as Record<string, unknown>
  if (m.type !== "system" || m.subtype !== "init") return undefined
  const terminalOnly = new Set(strs(m.terminal_slash_commands))
  const connectors = Array.isArray(m.mcp_servers)
    ? m.mcp_servers
        .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
        .filter((x) => typeof x.name === "string")
        .map((x) => ({
          name: String(x.name),
          status: typeof x.status === "string" ? x.status : "unknown",
        }))
    : []
  const plugins = Array.isArray(m.plugins)
    ? m.plugins
        .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
        .filter((x) => typeof x.name === "string")
        .map((x) => ({
          name: String(x.name),
          ...(typeof x.version === "string" ? { version: x.version } : {}),
        }))
    : []
  return {
    // Commands that only make sense in a terminal are left out of the menu.
    slashCommands: strs(m.slash_commands).filter((c) => !terminalOnly.has(c)),
    skills: strs(m.skills),
    connectors,
    plugins,
    ...(typeof m.model === "string" ? { model: m.model } : {}),
    ...(typeof m.claude_code_version === "string" ? { version: m.claude_code_version } : {}),
  }
}
