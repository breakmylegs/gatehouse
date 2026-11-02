// Appends N records to an audit log from a separate process. Used to test cross-process locking.
import { AuditWriter } from "../../src/audit/index.js"

const [dir, countText, id] = process.argv.slice(2)
if (!dir || !countText || !id) throw new Error("usage: append-worker <dir> <count> <id>")

const writer = new AuditWriter({ dir, redact: (v) => v, lockTimeoutMs: 20000 })
for (let i = 0; i < Number(countText); i++) {
  await writer.append({
    session: `worker-${id}`,
    event: "test",
    channel: "approver",
    tool: "Bash",
    input: { command: `echo ${id}-${i}` },
    verdict: {
      outcome: "allow",
      ruleId: "safe-shell",
      reason: "ok",
      risk: 0,
      decidedBy: "rules",
      policyHash: "h".repeat(64),
    },
    latencyMs: 1,
  })
}
