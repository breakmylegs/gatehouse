import { auditDir } from "../node/paths.js"
import fs from "node:fs"
import { anchorsDirFor } from "./anchors.js"
import { verifyAudit } from "./verify.js"
import { verifyTimelineExport } from "./verify-timeline.js"

const args = process.argv.slice(2)
const json = args.includes("--json")
const dir = args.find((a) => !a.startsWith("--")) ?? auditDir()
// D-029: the anchors beside the audit folder, or those named with --anchors=<folder>.
const anchorsDir = args.find((a) => a.startsWith("--anchors="))?.slice("--anchors=".length) ?? anchorsDirFor(dir)

const chain = verifyAudit(dir, fs.existsSync(anchorsDir) ? { anchorsDir } : {})
// C-011: a signed timeline export is checked too, when the folder holds one.
const timeline = verifyTimelineExport(dir)
const result = { ...chain, ok: chain.ok && timeline.length === 0, problems: [...chain.problems, ...timeline] }
if (json) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  const head = result.head
    ? ` Head: seq ${result.head.seq}, hash ${result.head.hash.slice(0, 16)}.`
    : ""
  const anchors = result.anchors ? ` ${result.anchors} anchor(s) match.` : ""
  console.log(`Audit chain OK: ${result.records} records in ${result.files} file(s).${head}${anchors}`)
} else {
  console.error(`Audit chain BROKEN in ${dir}: ${result.problems.length} problem(s).`)
  for (const p of result.problems) {
    console.error(
      `  ${p.file}${p.line > 0 ? `:${p.line}` : ""}${p.seq !== undefined ? ` (seq ${p.seq})` : ""}: ${p.reason}`,
    )
  }
}
process.exitCode = result.ok ? 0 : 1
