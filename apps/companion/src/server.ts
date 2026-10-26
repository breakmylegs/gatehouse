import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { COMPANION_TOOLS, CompanionHandlers } from "./handlers.js"

/** The Companion as a stdio MCP server (spec section 10). */
export function createCompanionMcpServer(handlers: CompanionHandlers): McpServer {
  const server = new McpServer({ name: "companion", version: "0.0.0" })
  for (const def of COMPANION_TOOLS) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.shape }, async (args: Record<string, unknown>) => {
      const out = await def.run(handlers, args)
      return { content: [{ type: "text" as const, text: out.text }], ...(out.isError ? { isError: true } : {}) }
    })
  }
  return server
}
