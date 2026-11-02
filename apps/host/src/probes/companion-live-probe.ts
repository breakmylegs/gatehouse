/**
 * Probe, not product code: does a live session load and call the in-process Companion, and what source does
 * the SDK report for it in canUseTool and the PreToolUse hook?
 * Usage: npx tsx apps/host/src/probes/companion-live-probe.ts <scratch-dir>
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { PolicyStore, redact } from "@gatehouse/policy"
import { sanitiseEnv } from "@gatehouse/shared"
import { createCompanionSdkServer } from "../companion-server.js"

const cwd = process.argv[2]
if (!cwd) throw new Error("usage: companion-live-probe <scratch-dir>")
const here = path.dirname(fileURLToPath(import.meta.url))
const store = new PolicyStore({ rulesPath: path.resolve(here, "../../../../policy/rules.yaml") })
store.load()

const seen: unknown[] = []
const q = query({
  prompt:
    "Call the get_policy_summary tool from the companion MCP server, then reply with the first line of what it returned.",
  options: {
    cwd,
    permissionMode: "default",
    env: sanitiseEnv(process.env),
    mcpServers: {
      companion: createCompanionSdkServer({
        sessionId: "live-probe",
        cwd,
        host: { notify: async () => true },
        policy: () => store.current,
        redact: (v) => redact(v),
      }),
    },
    strictMcpConfig: true,
    maxTurns: 4,
    settingSources: [],
    canUseTool: async (toolName, input, options) => {
      seen.push({ via: "canUseTool", toolName, mcpServer: options.mcpServer })
      return { behavior: "allow", updatedInput: input }
    },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              if (input.hook_event_name === "PreToolUse")
                seen.push({
                  via: "PreToolUse",
                  tool: input.tool_name,
                  mcp_server: input.mcp_server,
                })
              return {}
            },
          ],
        },
      ],
    },
  },
})
let final = ""
for await (const msg of q) {
  if (msg.type === "assistant")
    for (const b of msg.message.content) if (b.type === "text") final = b.text
}
console.log(JSON.stringify({ seen, final: final.slice(0, 200) }, null, 1))
