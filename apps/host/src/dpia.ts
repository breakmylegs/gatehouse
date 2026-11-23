/**
 * E-067, a DPIA draft (Expansion E5). The sections of a data protection impact assessment (UK GDPR and GDPR article 35,
 * and the ICO's template), drafted from D-051's personal data flow map: what is processed and where each flow goes,
 * the risk each kind of destination carries, and the measures to consider. Every mapped flow appears in it. What the
 * code cannot say (the purpose, the lawful basis, necessity, who is consulted, sign-off) is marked as needing your
 * input, and the whole is marked as a draft for legal review: it is not an assessment.
 */
import type { Flow, PersonalDataMap } from "./personal-data.js"

const SINK = {
  log: { to: "a log", risk: "Personal data in logs is kept and copied beyond its purpose, and read by people and tools that do not need it.", measure: "Leave it out of the log, mask it, or keep such logs for a short, set time with restricted access." },
  storage: { to: "storage", risk: "Stored personal data must be kept no longer than needed, secured, and found and erased on request.", measure: "Set a retention period, encrypt it at rest, restrict access, and make sure access and erasure requests reach it." },
  network: { to: "a network call", risk: "Personal data sent to another system or organisation may leave the UK or EU, or be used for something else.", measure: "Name the recipient, put a processing agreement in place, check where it is processed, and send only what is needed." },
} as const

const INPUT = "**Needs your input.**"

export function dpiaDraft(project: string, m: PersonalDataMap, o: { residency?: string } = {}): string {
  const rows = (xs: string[][]) => xs.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`)
  const categories = [...new Set(m.fields.map((f) => f.category))]
  const sinks = [...new Set(m.flows.map((f) => f.sink))] as Array<Flow["sink"]>
  return [
    `# Data protection impact assessment: ${project}`,
    "",
    "**DRAFT FOR LEGAL REVIEW.** Drafted by Codehouse from the code by name patterns (D-051's personal data flow map). It is not an assessment: a name can mislead, a flow through another function or file is not followed, and the sections marked as needing your input cannot be read from code. Your data protection officer reviews and completes it.",
    "",
    "## 1. The need for a DPIA",
    "",
    `The code handles ${categories.length ? categories.join(", ") : "no data that looks personal by its name"}${m.flows.length ? `, in ${m.flows.length} flow(s) to ${sinks.map((s) => SINK[s].to).join(", ")}` : ""}. ${INPUT} Whether the processing is likely to result in a high risk (article 35(3) and the ICO's list), and so whether a DPIA is required.`,
    "",
    "## 2. The nature of the processing",
    "",
    `Scope read: project ${m.scope.root}, ${m.scope.files} source file(s); left out: ${m.scope.skipped.join(", ")}.`,
    "",
    "Every flow found, where it is in the code:",
    "",
    "| # | Field | Kind | Goes to | File | Line |",
    "|---|---|---|---|---|---|",
    ...rows(m.flows.map((f, i) => [String(i + 1), f.field, f.category, SINK[f.sink].to, f.file, String(f.line)])),
    ...(m.flows.length ? [] : ["| | No flow found | | | | |"]),
    "",
    `${INPUT} How the data is collected, who it is about, how many people, and how long it is kept.`,
    "",
    "## 3. The scope of the processing",
    "",
    "| Field | Kind | Places in the code |",
    "|---|---|---|",
    ...rows(m.fields.map((f) => [f.name, f.category, String(f.places)])),
    "",
    `${INPUT} Whether any of it is special category or criminal offence data (article 9 and 10), which names do not show.`,
    "",
    "## 4. The context and purposes",
    "",
    `${INPUT} The purpose of each flow, the lawful basis (article 6), the relationship with the people concerned and what they would expect.`,
    "",
    ...(o.residency ? ["Where the AI sessions that worked on this project sent their words (E-068):", "", o.residency.trim(), ""] : []),
    "## 5. Necessity and proportionality",
    "",
    `${INPUT} For each flow above, why it is needed and whether less data would do; how accuracy, minimisation, the rights of the people concerned and any international transfers are handled.`,
    "",
    "## 6. Risks",
    "",
    "| # | Flow | Risk | Likelihood | Severity |",
    "|---|---|---|---|---|",
    ...rows(m.flows.map((f, i) => [String(i + 1), `${f.field} to ${SINK[f.sink].to} (${f.file}:${f.line})`, SINK[f.sink].risk, "Needs your input", "Needs your input"])),
    "",
    "## 7. Measures to reduce the risks",
    "",
    ...(sinks.length ? sinks.map((s) => `- Flows to ${SINK[s].to}: ${SINK[s].measure}`) : ["- No flow found to reduce."]),
    "",
    `${INPUT} The measures taken, the residual risk, and whether it is approved.`,
    "",
    "## 8. Sign-off",
    "",
    "| Item | Name and date | Notes |",
    "|---|---|---|",
    "| Measures approved by | | |",
    "| Residual risks approved by | | |",
    "| DPO advice provided | | |",
    "| Consultation with the ICO (if the residual risk is high) | | |",
    "",
  ].join("\n")
}
