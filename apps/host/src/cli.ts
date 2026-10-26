/**
 * A terminal harness for the whole Host, so Phase 3 can be exercised without the UI.
 *
 *   npm run host:cli -- <folder> [--prompt "text"]... [--auto allow|deny|ask] [--plan] [--model <id>]
 *
 * It starts the real Host (Approver, policy, audit, broker), opens one session in the folder, sends each
 * prompt in turn, prints what happens, and answers approvals on the command line: allow, deny, edit,
 * remember, or stop the session. With `--auto` it answers by itself, for scripted runs.
 */
import readline from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { parseArgs } from "node:util"
import type { PendingView } from "./broker.js"
import { createHost } from "./bootstrap.js"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prompt: { type: "string", multiple: true },
    auto: { type: "string", default: "ask" },
    plan: { type: "boolean", default: false },
    model: { type: "string" },
  },
})
const cwd = positionals[0]
if (!cwd) {
  console.error('Usage: npm run host:cli -- <folder> [--prompt "text"]... [--auto allow|deny|ask] [--plan] [--model <id>]')
  process.exit(2)
}
if (!["allow", "deny", "ask"].includes(values.auto as string)) {
  console.error("--auto must be allow, deny or ask")
  process.exit(2)
}

const host = createHost({ log: (l) => console.error(`  [host] ${l}`) })
const rl = readline.createInterface({ input: stdin, output: stdout })

function card(v: PendingView): string {
  const r = v.request
  const lines = [
    "",
    `  APPROVAL NEEDED  (${r.kind}, risk ${r.verdict.risk}, rule ${r.verdict.ruleId})`,
    `  ${r.toolName} in ${r.project}`,
    `  ${r.verdict.reason}`,
  ]
  for (const [k, val] of Object.entries(v.rawInput)) {
    const text = typeof val === "string" ? val : JSON.stringify(val)
    lines.push(`    ${k}: ${text.length > 400 ? text.slice(0, 400) + "..." : text}`)
  }
  for (const seg of r.verdict.segments ?? []) lines.push(`    segment [${seg.outcome}] ${seg.ruleId}: ${seg.text}`)
  return lines.join("\n")
}

async function decide(v: PendingView): Promise<void> {
  console.log(card(v))
  const id = v.request.id
  if (values.auto === "allow") {
    console.log("  -> allowed automatically (--auto allow)")
    host.app.broker.resolve(id, { kind: "decision", decision: "allow" }, "desktop")
    return
  }
  if (values.auto === "deny") {
    console.log("  -> denied automatically (--auto deny)")
    host.app.broker.resolve(id, { kind: "decision", decision: "deny", message: "Denied by the command line harness" }, "desktop")
    return
  }
  for (;;) {
    const a = (await rl.question("  [a]llow  [d]eny  [m]essage-deny  [e]dit  [r]emember  [s]top session > ")).trim().toLowerCase()
    if (a === "a") {
      if (v.request.kind === "question") {
        const q = ((v.rawInput.questions as { question: string }[]) ?? []).map((x) => x.question)
        const answers: Record<string, string> = {}
        for (const question of q) answers[question] = (await rl.question(`  ${question} > `)).trim() || "(no answer)"
        host.app.broker.resolve(id, { kind: "answers", answers }, "desktop")
      } else {
        host.app.broker.resolve(id, { kind: "decision", decision: "allow" }, "desktop")
      }
      return
    }
    if (a === "d") return void host.app.broker.resolve(id, { kind: "decision", decision: "deny" }, "desktop")
    if (a === "m") {
      const message = (await rl.question("  message to Claude > ")).slice(0, 500)
      return void host.app.broker.resolve(id, { kind: "decision", decision: "deny", message }, "desktop")
    }
    if (a === "e") {
      const field = v.request.toolName === "Bash" || v.request.toolName === "PowerShell" ? "command" : "file_path"
      const edited = await rl.question(`  new ${field} > `)
      return void host.app.broker.resolve(id, { kind: "decision", decision: "allow", updatedInput: { ...v.rawInput, [field]: edited } }, "desktop")
    }
    if (a === "r") return void host.app.broker.resolve(id, { kind: "decision", decision: "allow", remember: true }, "desktop")
    if (a === "s") {
      host.app.broker.resolve(id, { kind: "decision", decision: "deny", message: "Stopped by the user" }, "desktop")
      await host.app.manager.interruptAll()
      return
    }
  }
}

host.app.broker.on("created", (v) => void decide(v))
host.app.broker.on("resolved", ({ resolution }) => console.log(`  -> ${resolution.outcome} on ${resolution.channel}${resolution.message ? `: ${resolution.message}` : ""}`))

function show(msg: { type: string } & Record<string, unknown>): void {
  if (msg.type === "result") {
    const u = (msg.usage ?? {}) as Record<string, number>
    console.log(`  [result] reported cost $${msg.total_cost_usd}, in ${u.input_tokens}, out ${u.output_tokens}, turns ${msg.num_turns}`)
    if (process.env.GH_DEBUG_USAGE) console.log(`  [modelUsage] ${JSON.stringify(msg.modelUsage)}`)
  }
  if (msg.type === "assistant") {
    const content = ((msg.message as { content?: { type: string; text?: string; name?: string; input?: unknown }[] })?.content) ?? []
    for (const b of content) {
      if (b.type === "text" && b.text) console.log(`\nClaude: ${b.text}`)
      if (b.type === "tool_use") console.log(`  [tool] ${b.name} ${JSON.stringify(b.input).slice(0, 200)}`)
    }
  }
}

try {
  await host.start()
  const acct = await host.app.account.refresh()
  console.log(
    acct.signedIn
      ? `Signed in as ${acct.email ?? "?"} (${acct.organization ?? "no organisation"}). Managed policy: ${acct.managedPolicy}.`
      : "Not signed in.",
  )
  if (!acct.org.ok) console.log(`Organisation check: ${acct.org.message}`)
  const session = await host.app.manager.start({ cwd, ...(values.plan ? { mode: "plan" as const } : {}), ...(values.model ? { model: values.model } : {}) })
  session.on("message", (m) => show(m as never))
  session.on("event", (e) => console.log(`  [${e.type}] ${JSON.stringify(e.data).slice(0, 200)}`))
  console.log(`Session ${session.id} in ${session.cwd} (mode ${session.info().mode}).`)

  const prompts = values.prompt ?? []
  const turnDone = () =>
    new Promise<void>((resolve) => {
      const h = (m: { type: string }) => {
        if (m.type === "result") {
          session.off("message", h as never)
          resolve()
        }
      }
      session.on("message", h as never)
    })
  if (prompts.length > 0) {
    for (const p of prompts) {
      console.log(`\nYou: ${p}`)
      const done = turnDone()
      session.prompt(p)
      await done
    }
  } else {
    for (;;) {
      const p = (await rl.question("\nYou: ")).trim()
      if (p === "" || p === "exit" || p === "quit") break
      const done = turnDone()
      session.prompt(p)
      await done
    }
  }
  const u = host.app.usage.snapshot()
  console.log(`\nUsage: ${u.total.results} turn(s), ${u.total.inputTokens} in, ${u.total.outputTokens} out, $${u.total.costUsd.toFixed(4)}.`)
} catch (e) {
  console.error(`\n${(e as Error).message}`)
  process.exitCode = 1
} finally {
  rl.close()
  await host.stop().catch(() => undefined)
  process.exit(process.exitCode ?? 0)
}
