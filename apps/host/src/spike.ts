/**
 * Phase 0 spike. One streaming-input session that records what the SDK does:
 * account and org, managed settings, canUseTool on a Write, the PreToolUse hook on a Read,
 * and whether CLAUDE.md loads. Usage: npm run host:cli -- <scratch-dir>
 */
import { query, resolveSettings } from "@anthropic-ai/claude-agent-sdk"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { sanitiseEnv } from "@gatehouse/shared"

const cwd = process.argv[2]
if (!cwd) {
  console.error("Usage: npm run host:cli -- <scratch-dir>")
  process.exit(2)
}

const log = (tag: string, data: unknown) => console.log(`[${tag}] ${JSON.stringify(data)}`)

const seen = { canUseTool: [] as string[], preToolUse: [] as string[] }

const prompt =
  "Do these in order. 1) Read the file hello.txt. 2) Create a file named out.txt containing the text hi. " +
  "3) Reply with the codeword from CLAUDE.md, or say NO CODEWORD if you cannot see one."

async function* input(done: Promise<void>): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
  }
  await done
}

let finish!: () => void
const done = new Promise<void>((resolve) => (finish = resolve))

const q = query({
  prompt: input(done),
  options: {
    cwd,
    permissionMode: "default",
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],
    includePartialMessages: false,
    env: sanitiseEnv(process.env),
    canUseTool: async (toolName, toolInput, options) => {
      seen.canUseTool.push(toolName)
      log("canUseTool", { toolName, keys: Object.keys(toolInput), title: options.title })
      return { behavior: "deny", message: "Spike: Gatehouse denies every escalation." }
    },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (hookInput) => {
              if (hookInput.hook_event_name === "PreToolUse") {
                seen.preToolUse.push(hookInput.tool_name)
                log("PreToolUse", { tool: hookInput.tool_name, id: hookInput.tool_use_id })
              }
              return {}
            },
          ],
        },
      ],
    },
  },
})

try {
  const init = await q.initializationResult()
  const account = init.account
  log("account", {
    organization: account.organization,
    subscriptionType: account.subscriptionType,
    apiProvider: account.apiProvider,
    tokenSource: account.tokenSource,
    signedIn: Boolean(account.email),
  })
  log("slashCommandCount", init.commands.length)

  const resolved = await resolveSettings({ cwd, settingSources: ["user", "project", "local"] })
  log(
    "settingsSources",
    resolved.sources.map((s) => ({ source: s.source, origin: s.policyOrigin })),
  )

  let finalText = ""
  for await (const msg of q) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") finalText = block.text
      }
    }
    if (msg.type === "result") {
      log("result", { subtype: msg.subtype, turns: msg.num_turns, costUsd: msg.total_cost_usd })
      finish()
    }
  }
  log("finalText", finalText)
  log("summary", seen)
} finally {
  finish()
  q.close()
}
