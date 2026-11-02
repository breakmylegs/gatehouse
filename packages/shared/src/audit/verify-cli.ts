import { auditDir } from "../node/paths.js"
import { verifyAudit } from "./verify.js"

const args = process.argv.slice(2)
const json = args.includes("--json")
const dir = args.find((a) => !a.startsWith("--")) ?? auditDir()

const result = verifyAudit(dir)
if (json) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  const head = result.head
    ? ` Head: seq ${result.head.seq}, hash ${result.head.hash.slice(0, 16)}.`
    : ""
  console.log(`Audit chain OK: ${result.records} records in ${result.files} file(s).${head}`)
} else {
  console.error(`Audit chain BROKEN in ${dir}: ${result.problems.length} problem(s).`)
  for (const p of result.problems) {
    console.error(
      `  ${p.file}${p.line > 0 ? `:${p.line}` : ""}${p.seq !== undefined ? ` (seq ${p.seq})` : ""}: ${p.reason}`,
    )
  }
}
process.exitCode = result.ok ? 0 : 1
