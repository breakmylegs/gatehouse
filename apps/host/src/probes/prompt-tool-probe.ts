/**
 * Probe, not product code: what does Claude Code send to a permission-prompt tool, and what does it accept back?
 * Uses an in-process SDK server, because this machine's policy blocks stdio and HTTP servers.
 * Usage: npx tsx apps/host/src/prompt-tool-probe.ts <scratch-dir> <allow|deny|text-allow|bare>
 */
import fs from "node:fs"
import path from "node:path"
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import { sanitiseEnv } from "@gatehouse/shared"

const [cwd, mode = "allow"] = process.argv.slice(2)
if (!cwd) throw new Error("usage: prompt-tool-probe <scratch-dir> <mode>")
const out = path.join(cwd, "out.txt")
fs.rmSync(out, { force: true })
const seen: unknown[] = []

const server = createSdkMcpServer({
  name: "inproc",
  version: "0.0.0",
  tools: [
    tool(
      "approve",
      "Permission prompt",
      { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
      async (args) => {
        seen.push(args)
        const allow = JSON.stringify({ behavior: "allow", updatedInput: args.input })
        const deny = JSON.stringify({ behavior: "deny", message: "Probe says no: the policy refuses this." })
        const text = mode === "deny" ? deny : mode === "bare" ? JSON.stringify({ behavior: "allow" }) : allow
        return { content: [{ type: "text", text }] }
      },
    ),
  ],
})

const q = query({
  prompt: "Create a file named out.txt in the current directory containing the word hi, then reply with the single word done.",
  options: {
    cwd,
    permissionMode: "default",
    env: sanitiseEnv(process.env),
    mcpServers: { inproc: server },
    strictMcpConfig: true,
    permissionPromptToolName: "mcp__inproc__approve",
    maxTurns: 6,
    settingSources: [],
  },
})
let final = ""
for await (const msg of q) {
  if (msg.type === "assistant") {
    for (const b of msg.message.content) if (b.type === "text") final = b.text
  }
  if (msg.type === "user") {
    const c = (msg as { message?: { content?: unknown } }).message?.content
    if (Array.isArray(c)) {
      for (const b of c as { type?: string; content?: unknown; is_error?: boolean }[]) {
        if (b.type === "tool_result" && b.is_error) console.log("tool_result error:", JSON.stringify(b.content).slice(0, 200))
      }
    }
  }
}
console.log(JSON.stringify({ mode, promptToolCalls: seen, fileWritten: fs.existsSync(out), final: final.slice(0, 120) }, null, 1))
