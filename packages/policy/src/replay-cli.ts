import { parseArgs } from "node:util"
import { PolicyEngine } from "./engine.js"
import { loadPolicy, PolicyLoadError } from "./loader.js"
import { PwshWorker } from "./pwsh.js"
import { readReplayFile, replay } from "./replay.js"

const { values } = parseArgs({
  options: {
    rules: { type: "string" },
    audit: { type: "string" },
    overlays: { type: "string" },
    local: { type: "string" },
    "workspace-root": { type: "string", multiple: true },
    "rule-changes": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
})

if (!values.rules || !values.audit) {
  console.error(
    "Usage: npm run policy:replay -- --rules <candidate.yaml> --audit <file.jsonl> " +
      "[--overlays <dir>] [--local <rules.local.yaml>] [--workspace-root <dir>]... [--rule-changes] [--json]",
  )
  process.exit(2)
}

const pwsh = new PwshWorker()
try {
  const policy = loadPolicy({
    rulesPath: values.rules,
    overlayDir: values.overlays,
    localPath: values.local,
    workspaceRootsOverride: values["workspace-root"],
  })
  const engine = new PolicyEngine({ getPolicy: () => policy, pwsh })
  const { records, skipped } = readReplayFile(values.audit)
  const result = await replay(engine, records, skipped, { includeRuleChanges: values["rule-changes"] })
  if (values.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`Policy ${policy.hash.slice(0, 12)}: replayed ${result.total} decisions, ${result.changes.length} would change.`)
    for (const c of result.changes) {
      const tag = c.outcomeChanged ? "OUTCOME" : "rule"
      console.log(
        `line ${c.line} [${tag}] ${c.before.outcome}/${c.before.ruleId} -> ${c.after.outcome}/${c.after.ruleId}\n  ${c.summary}`,
      )
    }
    if (result.skipped.length > 0) console.log(`Skipped ${result.skipped.length} unreadable line(s): ${result.skipped.join(", ")}`)
  }
} catch (e) {
  if (e instanceof PolicyLoadError) {
    console.error(`Candidate rules did not load:\n- ${e.errors.join("\n- ")}`)
    process.exitCode = 1
  } else {
    throw e
  }
} finally {
  pwsh.close()
}
