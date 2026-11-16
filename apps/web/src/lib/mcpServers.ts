import { api } from "./api"

/** O39: an MCP server you built, as the Host lists it (mcp-builder/routes.ts). */
export interface BuiltServerView {
  name: string
  autostart: boolean
  cpu: number
  memoryMb: number
  entry: string
  state: "stopped" | "starting" | "running" | "failed"
  error?: string
  tools: Array<{ name: string; description?: string }>
  limited: boolean
  startedAt?: string
}

export const listServers = () => api<{ servers: BuiltServerView[] }>("GET", "/api/mcp-servers")
export const createServer = (name: string) => api<BuiltServerView>("POST", "/api/mcp-servers", { name })
export const changeServer = (name: string, c: { autostart?: boolean; cpu?: number; memoryMb?: number }) =>
  api<BuiltServerView>("PUT", `/api/mcp-servers/${encodeURIComponent(name)}`, c)
export const runServer = (name: string, action: "start" | "stop" | "restart") =>
  api<BuiltServerView>("POST", `/api/mcp-servers/${encodeURIComponent(name)}/${action}`, {})
export const removeServer = (name: string) => api<{ removed: string; folderKept: string }>("DELETE", `/api/mcp-servers/${encodeURIComponent(name)}`)
export const buildServer = (name: string) => api<{ sessionId: string }>("POST", `/api/mcp-servers/${encodeURIComponent(name)}/build`, {})
export const giveServer = (sessionId: string, name: string) =>
  api<{ name: string; tools: string[] }>("POST", `/api/sessions/${encodeURIComponent(sessionId)}/mcp`, { name })

/**
 * The /mcp completions for what is typed: "/mcp" or "/mcp gr" lists the running servers whose names start so, each as
 * the whole command, so Tab completes it. Anything else, none.
 */
export function mcpMatches(text: string, servers: readonly BuiltServerView[]): Array<{ cmd: string; help: string }> {
  const m = /^\/mcp(?: (\S*))?$/i.exec(text)
  if (!m) return []
  const typed = (m[1] ?? "").toLowerCase()
  return servers
    .filter((s) => s.state === "running" && s.name.startsWith(typed))
    .map((s) => ({ cmd: `/mcp ${s.name}`, help: `${s.tools.length === 1 ? "1 tool" : `${s.tools.length} tools`}: ${s.tools.slice(0, 4).map((t) => t.name).join(", ")}` }))
}
