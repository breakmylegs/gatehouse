import fs from "node:fs"
import path from "node:path"
import type { AuditRecord } from "@gatehouse/shared/audit"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"
import { INSTRUCTIONS_RULE, type InstructionPins } from "./instruction-pins.js"
import { lessonsFrom, withLesson, type Lesson } from "./lessons.js"
import { TestLocks } from "./test-locks.js"

/** D-073: reading and adding lessons for a project's CLAUDE.md (see lessons.ts). */
const claudeMdOf = (cwd: string) => path.join(TestLocks.rootOf(cwd), "CLAUDE.md")

const read = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

export function lessonsFor(records: AuditRecord[], cwd: string): Lesson[] {
  return lessonsFrom(records, TestLocks.rootOf(cwd), read(claudeMdOf(cwd)))
}

/**
 * Adds one lesson to the project's CLAUDE.md, through D-059: refused while what the project tells Claude has a change
 * from outside Codehouse you have not reviewed (adding would pin it unread), recorded before the file is written, and
 * CLAUDE.md pinned again as written. A string says why it was not added.
 */
export async function addLesson(o: {
  pins: InstructionPins
  audit: Pick<HostAudit, "record">
  records: AuditRecord[]
  cwd: string
  key: string
}): Promise<{ added: Lesson; lessons: Lesson[] } | string> {
  const lesson = lessonsFor(o.records, o.cwd).find((l) => l.key === o.key)
  if (!lesson) return "That lesson is not proposed for this project (it may be in CLAUDE.md already)."
  const outside = await o.pins.changedOutside(o.cwd)
  if (outside.length) return `What this project tells Claude changed outside Codehouse (${outside.slice(0, 3).join(", ")}). Review and approve that first.`
  const file = claudeMdOf(o.cwd)
  const written = await o.audit.record({
    session: "desktop",
    event: "instruction_learnt",
    channel: "desktop",
    tool: "instructions",
    cwd: o.cwd,
    input: { file: "CLAUDE.md", key: lesson.key, line: lesson.line, evidence: lesson.evidence.map((e) => e.seq) },
    verdict: {
      outcome: "allow",
      ruleId: INSTRUCTIONS_RULE,
      reason: `You added a line to CLAUDE.md that your undos or denials suggested (${lesson.count} times).`,
      risk: 0,
      decidedBy: "human-desktop",
      policyHash: "",
    },
    latencyMs: 0,
  })
  if (!written) return "It could not be recorded, so CLAUDE.md was not changed."
  await writeFileAtomic(file, withLesson(read(file), lesson))
  await o.pins.repin(o.cwd, ["CLAUDE.md"])
  return { added: lesson, lessons: lessonsFor(o.records, o.cwd) }
}
