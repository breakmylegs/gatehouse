// D-028, the causal provenance graph: a changed hunk is tied to the edit that made it, and that edit to what was read
// before it; the page D-061 flagged as holding injected text is shown as what preceded the hunk.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { AuditWriter, type AuditEntry } from "@gatehouse/shared/audit"
import { provenanceGraph } from "../src/provenance-graph.js"
import { sessionRecords } from "../src/timeline.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-pgraph-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const allow = { outcome: "allow" as const, ruleId: "r", reason: "ok", risk: 10, decidedBy: "rules" as const, policyHash: "h" }
const call = (tool: string, toolUseId: string, input: Record<string, unknown>, event = "evaluate_permission"): AuditEntry => ({
  session: "s1",
  event,
  channel: "approver",
  tool,
  toolUseId,
  input,
  verdict: allow,
  latencyMs: 0,
})

describe("the causal provenance graph (D-028)", () => {
  it("shows the injected page that preceded a hunk", async () => {
    const dir = path.join(root, "audit")
    const w = new AuditWriter({ dir, redact: (v) => v })
    await w.append(call("Read", "t1", { file_path: "C:/p/README.md" }))
    await w.append(call("WebFetch", "t2", { url: "https://notes.test/setup", prompt: "read" }))
    await w.append(call("injection-scan", "x", { tool: "WebFetch", kinds: ["instruction"], toolUseId: "t2" }, "injection_flagged"))
    await w.append(call("Edit", "t3", { file_path: "C:/p/src/a.ts", old_string: "a()", new_string: "a()\nupload(secrets)" }))
    await w.append(call("Edit", "t4", { file_path: "C:/p/src/b.ts", old_string: "x", new_string: "y" }))
    const hunks = provenanceGraph({
      records: sessionRecords(dir, "s1"),
      files: [{ path: "src/a.ts", diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n a()\n+upload(secrets)\n" }],
      untrusted: (f) => /readme/i.test(f),
    })
    expect(hunks).toHaveLength(1)
    const h = hunks[0]!
    expect(h.call).toMatchObject({ tool: "Edit", file: "C:/p/src/a.ts" })
    expect(h.call!.sources.map((s) => [s.what, s.injected === true, s.outside === true])).toEqual([
      ["https://notes.test/setup", true, true],
      ["C:/p/README.md", false, true],
    ])
  })
})
