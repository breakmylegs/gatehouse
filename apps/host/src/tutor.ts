/**
 * E-072, tutor mode (Expansion E6). A session overlay for learning: the agent may read, run the tests and give hints,
 * and may write tests, but an edit to any other file is denied, in every mode (the floor hook refuses it too, so Auto
 * and Accept edits cannot let it through). A command that is not a plain test run goes to you. Like a role's scope
 * (E-046) it can only restrict: it never allows anything the rules would not. The session is told to teach: to explain,
 * give hints and ask questions rather than change the code for you.
 */
import path from "node:path"

export const TUTOR_EDIT_RULE = "tutor-mode"
export const TUTOR_COMMAND_RULE = "tutor-command"

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

/** A test file: in a test folder, or named as a test. */
export function isTestFile(file: string): boolean {
  const p = file.replace(/\\/g, "/")
  return /(^|\/)(__tests__|tests?|spec|e2e)\//i.test(p) || /[._-](test|spec)\.[a-z0-9]+$/i.test(p) || /(^|\/)test_[^/]+\.py$/i.test(p) || /(^|\/)[^/]+_test\.(py|go)$/i.test(p) || /Tests?\.cs$/.test(p)
}

/** A command that only runs the tests: one test runner, nothing chained to it. */
export function isTestRun(command: string): boolean {
  const c = command.trim()
  if (/[;&|`$<>]|\n/.test(c.replace(/\|\|\s*true\s*$/, ""))) return false
  return /^(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest|playwright\s+test)\b|vitest\b|jest\b|pytest\b|python\s+-m\s+(?:pytest|unittest)\b|dotnet\s+test\b|go\s+test\b|cargo\s+test\b|mvn\s+test\b|gradlew?\s+test\b|Invoke-Pester\b)/i.test(c)
}

export interface TutorVerdict {
  outcome: "deny" | "escalate"
  ruleId: string
  reason: string
}

/** What tutor mode makes of a call: a deny, an ask, or nothing (the rules decide). */
export function tutorOverlay(toolName: string, input: Record<string, unknown>, root: string): TutorVerdict | undefined {
  if (EDITS.has(toolName)) {
    const file = String(input.file_path ?? input.notebook_path ?? "")
    const rel = path.isAbsolute(file) ? path.relative(root, file) : file
    if (!file || !isTestFile(rel))
      return { outcome: "deny", ruleId: TUTOR_EDIT_RULE, reason: `Tutor mode: the agent may write tests, not ${rel || "this file"}. Give a hint, and let the learner make the change.` }
    return undefined
  }
  if ((toolName === "Bash" || toolName === "PowerShell") && typeof input.command === "string" && !isTestRun(input.command))
    return { outcome: "escalate", ruleId: TUTOR_COMMAND_RULE, reason: "Tutor mode: a command other than running the tests goes to you." }
  return undefined
}

/** What the session is told at the start. */
export function tutorPrompt(topic: string): string {
  return [
    "You are in tutor mode. Your job is to help me learn, not to do the work for me.",
    "- Do not change source files: Codehouse refuses edits to anything but tests. You may read the code, run the tests, and write tests.",
    "- Explain, give hints one step at a time, and ask me questions that lead me to the answer. Show small examples in your reply rather than editing files.",
    "- When I make a change, run the tests and tell me what they show.",
    "",
    `What I want to learn: ${topic.trim() || "this project"}.`,
  ].join("\n")
}
