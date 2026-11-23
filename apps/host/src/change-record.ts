/**
 * E-059, a change record and CAB pack (Expansion E5). An ITIL change record drafted from the evidence Codehouse holds:
 * description, risk, impact, tests, implementation, backout and schedule. Every field either says what it rests on (a
 * commit, a requirement, the readiness report, a checked claim, the backout check) or is marked as needing your input;
 * nothing is invented to fill a gap. The CAB pack is the record with the readiness report, as Markdown.
 */
import type { Readiness } from "./release-readiness.js"

export interface RecordInput {
  candidate: string
  commits: Array<{ sha: string; subject: string }>
  requirements: Array<{ id: string; title: string }>
  readiness: Readiness
  claims: Array<{ quote: string; outcome: string; command?: string }>
  files: string[]
  /** E-060's backout check, when it was run. */
  backout?: { reversible: boolean; detail: string }
  /** When it is to go in, when you have said. */
  schedule?: string
}

export interface RecordField {
  name: string
  text?: string
  evidence: string[]
  needsInput?: string
}

const SEVERITY = (r: Readiness) => (r.sections.some((s) => s.name === "Open escalations" && s.state === "blocks") ? "High" : r.ready ? "Low" : "Medium")

export function changeRecord(i: RecordInput): RecordField[] {
  const f: RecordField[] = []
  f.push(
    i.commits.length
      ? { name: "Description", text: [i.requirements.length ? `Delivers ${i.requirements.map((r) => `${r.id} (${r.title})`).join(", ")}.` : "", `Changes: ${i.commits.slice(0, 10).map((c) => c.subject).join("; ")}${i.commits.length > 10 ? `; and ${i.commits.length - 10} more` : ""}.`].filter(Boolean).join(" "), evidence: [...i.requirements.map((r) => `requirement ${r.id}`), ...i.commits.slice(0, 10).map((c) => `commit ${c.sha.slice(0, 10)}`)] }
      : { name: "Description", evidence: [], needsInput: "The candidate has no commits of its own; describe the change." },
  )
  f.push({ name: "Risk", text: `${SEVERITY(i.readiness)}. ${i.readiness.ready ? "The readiness report finds nothing blocking." : `The readiness report finds: ${i.readiness.reasons.join(" ")}`}`, evidence: ["the release readiness report"] })
  f.push(
    i.files.length
      ? { name: "Impact", text: `${i.files.length} file(s) change, in ${[...new Set(i.files.map((p) => p.split("/")[0]))].slice(0, 8).join(", ")}. Who and what it affects outside the code needs your judgement.`, evidence: ["the change since the last commit"], needsInput: "Name the users, services and teams it affects." }
      : { name: "Impact", evidence: [], needsInput: "No changed files were found; describe the impact." },
  )
  const verified = i.claims.filter((c) => c.outcome === "verified")
  const sealed = i.readiness.sections.find((s) => s.name === "Sealed checks")
  f.push(
    verified.length || sealed?.state === "ok"
      ? { name: "Tests", text: [verified.length ? `${verified.length} claim(s) that the work is done were Verified by running ${[...new Set(verified.map((c) => c.command).filter(Boolean))].join(", ") || "the checks"} again.` : "", sealed?.state === "ok" ? "The sealed checks pass." : ""].filter(Boolean).join(" "), evidence: [...(verified.length ? ["checked claims (D-009)"] : []), ...(sealed?.state === "ok" ? ["sealed checks (D-003)"] : [])] }
      : { name: "Tests", evidence: [], needsInput: "No checked evidence of tests: run the tests or the sealed checks, or say how it was tested." },
  )
  f.push(i.commits.length ? { name: "Implementation", text: `Merge and deploy ${i.candidate} (${i.commits.length} commit(s)), by the project's usual release steps.`, evidence: [`commit ${i.commits[0]!.sha.slice(0, 10)}`], needsInput: "Give the deployment steps and who carries them out." } : { name: "Implementation", evidence: [], needsInput: "Give the implementation steps." })
  f.push(i.backout ? { name: "Backout", text: i.backout.reversible ? `Revert the change; checked: ${i.backout.detail}` : `Not shown to be reversible: ${i.backout.detail}`, evidence: ["the backout check (E-060)"], ...(i.backout.reversible ? {} : { needsInput: "Give a backout plan that works." }) } : { name: "Backout", evidence: [], needsInput: "Run the backout check, or give the backout plan." })
  f.push(i.schedule ? { name: "Schedule", text: i.schedule, evidence: ["you"] } : { name: "Schedule", evidence: [], needsInput: "When it goes in, and the change window." })
  return f
}

/** The CAB pack: the record, then the readiness report. */
export function cabPack(candidate: string, fields: RecordField[], readinessMd: string): string {
  return [
    `# Change record: ${candidate}`,
    "",
    "Drafted by Codehouse from its evidence. Fields marked NEEDS INPUT are for you to complete before the CAB.",
    "",
    ...fields.flatMap((x) => [`## ${x.name}`, "", x.text ?? "", x.evidence.length ? `Evidence: ${x.evidence.join(", ")}.` : "", x.needsInput ? `**NEEDS INPUT:** ${x.needsInput}` : "", ""].filter((l, i, a) => l !== "" || a[i - 1] !== "")),
    readinessMd,
  ].join("\n")
}
