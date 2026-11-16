/**
 * O39: a server you built, as an in-process MCP server a session can load (type "sdk"; this computer's policy loads
 * no stdio or http server in a session). It passes the tool list and each call to the running server as they are, so
 * nothing about its tools is rewritten here. Each call still reaches canUseTool as mcp__built-<name>__<tool>, so the
 * floor, the rules and the audit decide it like any other server's (an unknown server asks), and what it returns counts
 * as untrusted (provenance.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk"
import type { McpRunner } from "./runner.js"

/** The name a session knows a built server by: never the Companion's, never another source's. */
export const bridgeName = (name: string) => `built-${name}`

/** A fresh in-process server for one session (an instance connects once). */
export function bridgeFor(runner: Pick<McpRunner, "client">, name: string): McpSdkServerConfigWithInstance {
  const mcp = new McpServer({ name: bridgeName(name), version: "1" }, { capabilities: { tools: {} } })
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: runner.client(name)?.tools ?? [] }))
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const live = runner.client(name)
    if (!live)
      return {
        isError: true,
        content: [{ type: "text" as const, text: `The MCP server ${name} is not running. Start it in Codehouse, MCP.` }],
      }
    return await live.client.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} })
  })
  return { type: "sdk", name: bridgeName(name), instance: mcp }
}
