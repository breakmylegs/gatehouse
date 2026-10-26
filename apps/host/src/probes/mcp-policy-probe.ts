/**
 * Probe, not product code: which kinds of MCP server does this machine's policy let an SDK session load?
 * Usage: npx tsx apps/host/src/mcp-policy-probe.ts <scratch-dir>
 */
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { sanitiseEnv } from "@gatehouse/shared"

const cwd = process.argv[2]
if (!cwd) throw new Error("usage: mcp-policy-probe <scratch-dir>")

const sdkServer = createSdkMcpServer({
  name: "inproc",
  version: "0.0.0",
  tools: [tool("ping", "Returns pong", { who: z.string().optional() }, async () => ({ content: [{ type: "text", text: "pong" }] }))],
})

const cases: Record<string, Record<string, unknown>> = {
  "stdio server": { probe_stdio: { type: "stdio", command: "node", args: ["C:/dev/gatehouse-spike/prompt-tool.mjs"] } },
  "http server": { probe_http: { type: "http", url: "http://127.0.0.1:47821/mcp" } },
  "in-process sdk server": { inproc: sdkServer },
}

for (const [name, servers] of Object.entries(cases)) {
  const q = query({
    prompt: "Reply with the single word ok.",
    options: {
      cwd,
      permissionMode: "default",
      env: sanitiseEnv(process.env),
      mcpServers: servers as never,
      strictMcpConfig: true,
      maxTurns: 1,
      settingSources: ["user", "project", "local"],
    },
  })
  let status: unknown = "no init message"
  for await (const msg of q) {
    if (msg.type === "system" && msg.subtype === "init") {
      status = (msg as unknown as { mcp_servers?: unknown }).mcp_servers
      break
    }
  }
  q.close()
  console.log(`${name.padEnd(24)} ${JSON.stringify(status)}`)
}
