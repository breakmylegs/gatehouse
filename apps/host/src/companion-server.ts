import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { COMPANION_TOOLS, CompanionHandlers, type CompanionDeps } from "@gatehouse/companion"

/**
 * The Companion as an in-process MCP server. This machine's managed policy stops stdio and http MCP
 * servers from loading into a session, but a server the Host registers itself (source "sdk") is allowed,
 * so the Host uses this form. It has the same name, so the tools keep their names (mcp__companion__*), and
 * the same handlers as the stdio Companion.
 */
export function createCompanionSdkServer(deps: CompanionDeps) {
  const handlers = new CompanionHandlers(deps)
  return createSdkMcpServer({
    name: "companion",
    version: "0.0.0",
    tools: COMPANION_TOOLS.map((def) =>
      tool(def.name, def.description, def.shape, async (args: Record<string, unknown>) => {
        const out = await def.run(handlers, args)
        return { content: [{ type: "text" as const, text: out.text }], ...(out.isError ? { isError: true } : {}) }
      }),
    ),
  })
}
