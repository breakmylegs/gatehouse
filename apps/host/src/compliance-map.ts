/**
 * E-065, DORA and NIS2 evidence mapping (Expansion E5). A draft index of what Codehouse holds for a project, mapped
 * to the control areas of DORA (Regulation (EU) 2022/2554) and NIS2 (Directive (EU) 2022/2555, article 21(2) and the
 * reporting of article 23): its audit records (decisions, floor denials, incidents, sealed checks, change records,
 * backout checks, secrets asked for, signed anchors), the evidence packs on its commits, Codehouse's policy and its
 * controls (the kill switch, undo points), the AI system register and the data residency record. Each control area
 * either links to the evidence found for the period, or is listed as a gap with what would serve. It is Codehouse's
 * reading of the areas for an assessor to check, not legal advice, and it covers only what Codehouse sees.
 */
import type { AuditRecord } from "@gatehouse/shared/audit"

export type SourceId =
  | "audit-log"
  | "decisions"
  | "floor-denials"
  | "policy"
  | "kill-switch"
  | "undo-points"
  | "incidents"
  | "policy-regressions"
  | "sealed-checks"
  | "evidence-packs"
  | "change-records"
  | "backout-checks"
  | "secrets"
  | "anchors"
  | "licences"
  | "ai-register"
  | "residency"

export interface Source {
  name: string
  present: boolean
  detail: string
}

export type Sources = Record<SourceId, Source>

export interface Control {
  framework: "DORA" | "NIS2"
  ref: string
  title: string
  serves: SourceId[]
}

export const CONTROLS: Control[] = [
  { framework: "DORA", ref: "Art. 5-6", title: "ICT risk management framework and governance", serves: ["policy", "audit-log", "anchors"] },
  { framework: "DORA", ref: "Art. 8", title: "Identification of ICT assets, dependencies and risks", serves: ["ai-register", "licences"] },
  { framework: "DORA", ref: "Art. 9", title: "Protection and prevention, including access and change management", serves: ["decisions", "change-records", "secrets", "policy"] },
  { framework: "DORA", ref: "Art. 10", title: "Detection of anomalous activity", serves: ["floor-denials", "incidents"] },
  { framework: "DORA", ref: "Art. 11-12", title: "Response and recovery, backup and restoration", serves: ["kill-switch", "undo-points", "backout-checks"] },
  { framework: "DORA", ref: "Art. 13", title: "Learning and evolving", serves: ["policy-regressions"] },
  { framework: "DORA", ref: "Art. 17-19", title: "ICT-related incident management, classification and reporting", serves: ["incidents"] },
  { framework: "DORA", ref: "Art. 24-25", title: "Digital operational resilience testing", serves: ["sealed-checks", "evidence-packs"] },
  { framework: "DORA", ref: "Art. 28-30", title: "ICT third-party risk and the register of information", serves: ["ai-register", "residency", "licences"] },
  { framework: "NIS2", ref: "Art. 21(2)(a)", title: "Risk analysis and information system security policies", serves: ["policy"] },
  { framework: "NIS2", ref: "Art. 21(2)(b)", title: "Incident handling", serves: ["incidents", "kill-switch"] },
  { framework: "NIS2", ref: "Art. 21(2)(c)", title: "Business continuity, backup management, disaster recovery and crisis management", serves: ["undo-points", "backout-checks"] },
  { framework: "NIS2", ref: "Art. 21(2)(d)", title: "Supply chain security", serves: ["licences", "ai-register", "residency"] },
  { framework: "NIS2", ref: "Art. 21(2)(e)", title: "Security in acquisition, development and maintenance, including vulnerability handling", serves: ["sealed-checks", "evidence-packs", "change-records"] },
  { framework: "NIS2", ref: "Art. 21(2)(f)", title: "Assessing the effectiveness of the measures", serves: ["sealed-checks", "anchors", "policy-regressions"] },
  { framework: "NIS2", ref: "Art. 21(2)(g)", title: "Basic cyber hygiene practices and cybersecurity training", serves: [] },
  { framework: "NIS2", ref: "Art. 21(2)(h)", title: "Cryptography and encryption", serves: ["anchors"] },
  { framework: "NIS2", ref: "Art. 21(2)(i)", title: "Human resources security, access control and asset management", serves: ["decisions", "secrets", "ai-register"] },
  { framework: "NIS2", ref: "Art. 21(2)(j)", title: "Multi-factor authentication and secured communications", serves: [] },
  { framework: "NIS2", ref: "Art. 23", title: "Reporting obligations for significant incidents", serves: ["incidents"] },
]

const EVENTS: Partial<Record<SourceId, string[]>> = {
  decisions: ["decision", "human_decision"],
  "floor-denials": ["floor_deny"],
  incidents: ["kill_switch_engaged", "session_restarted_after_crash", "crash_bundle_exported", "process_stopped", "task_stopped"],
  "policy-regressions": ["policy_regression_accepted", "policy_regression_blocked"],
  "sealed-checks": ["sealed_check_run", "sealed_check_changed"],
  "change-records": ["release_readiness"],
  "backout-checks": ["backout_checked"],
  secrets: ["secret_requested", "secret_used"],
  anchors: ["anchor_signed"],
  licences: ["licence_escalated", "notices_written"],
}

const NAMES: Record<SourceId, string> = {
  "audit-log": "The hash-chained audit log",
  decisions: "Permission decisions",
  "floor-denials": "Floor denials",
  policy: "Codehouse's policy rules",
  "kill-switch": "The kill switch",
  "undo-points": "Undo points",
  incidents: "Incidents (kill switch, crashes, stopped processes)",
  "policy-regressions": "Policy regression checks",
  "sealed-checks": "Sealed checks (D-003)",
  "evidence-packs": "Evidence packs on commits (D-030)",
  "change-records": "Release readiness and change records (E-058, E-059)",
  "backout-checks": "Backout checks (E-060)",
  secrets: "Secrets asked for and used",
  anchors: "Signed audit anchors",
  licences: "Licence checks and third-party notices (D-055, E-070)",
  "ai-register": "The AI system register (E-069)",
  residency: "The data residency record (E-068)",
}

export interface GatherInput {
  project: string
  records: AuditRecord[]
  /** Commits read, and how many carry an evidence pack. */
  packs: { commits: number; withPack: number }
  aiModels: number
  residencySessions: number
  policyHash?: string
}

/** What Codehouse holds for the project, from its audit records in the period and its other records. */
export function gatherSources(i: GatherInput): Sources {
  const mine = i.records.filter((r) => r.project === i.project)
  const count = (events: string[]) => mine.filter((r) => events.includes(r.event)).length
  const out = {} as Sources
  for (const id of Object.keys(NAMES) as SourceId[]) {
    const events = EVENTS[id]
    if (events) {
      const n = count(events)
      out[id] = { name: NAMES[id], present: n > 0, detail: n ? `${n} audit record(s): ${events.filter((e) => mine.some((r) => r.event === e)).join(", ")}` : `no ${events.join(" or ")} record in the period` }
    }
  }
  out["audit-log"] = { name: NAMES["audit-log"], present: mine.length > 0, detail: mine.length ? `${mine.length} record(s) for ${i.project} in the period, each chained to the one before` : `no record for ${i.project} in the period` }
  out.policy = { name: NAMES.policy, present: !!i.policyHash, detail: i.policyHash ? `in force, policy hash ${i.policyHash.slice(0, 12)}, named in every decision record` : "the policy could not be read" }
  // A control Codehouse always has: evidence of the control, not of its use.
  out["kill-switch"] = { name: NAMES["kill-switch"], present: true, detail: `a Codehouse control: stops every session at once, from the desktop or the phone${count(["kill_switch_engaged"]) ? `; used ${count(["kill_switch_engaged"])} time(s) in the period` : ""}` }
  out["undo-points"] = { name: NAMES["undo-points"], present: true, detail: "a Codehouse control: an undo point before edits and before commands that delete or discard work" }
  out["evidence-packs"] = { name: NAMES["evidence-packs"], present: i.packs.withPack > 0, detail: i.packs.commits ? `${i.packs.withPack} of the last ${i.packs.commits} commit(s) carry an evidence pack` : "no commit to read" }
  out["ai-register"] = { name: NAMES["ai-register"], present: i.aiModels > 0, detail: i.aiModels ? `${i.aiModels} model use(s) registered with their cards` : "no model registered for the project" }
  out.residency = { name: NAMES.residency, present: i.residencySessions > 0, detail: i.residencySessions ? `${i.residencySessions} session(s) with their endpoint and region` : "no session recorded" }
  return out
}

export interface IndexRow {
  control: Control
  evidence: Array<{ source: SourceId; name: string; detail: string }>
  gap: boolean
  /** For a gap: what would serve, or that Codehouse holds nothing for it. */
  wouldServe: string
}

export function complianceIndex(sources: Sources): IndexRow[] {
  return CONTROLS.map((control) => {
    const evidence = control.serves.filter((s) => sources[s]?.present).map((s) => ({ source: s, name: sources[s].name, detail: sources[s].detail }))
    return {
      control,
      evidence,
      gap: evidence.length === 0,
      wouldServe: control.serves.length ? control.serves.map((s) => sources[s]?.name ?? s).join("; ") : "nothing Codehouse records: evidence from outside Codehouse is needed",
    }
  })
}

export function indexMarkdown(project: string, period: string, rows: IndexRow[]): string {
  const gaps = rows.filter((r) => r.gap)
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
  return [
    `# DORA and NIS2 evidence index: ${project}`,
    "",
    `**DRAFT.** Codehouse's mapping of what it holds for ${project} (${period}) to the control areas, for an assessor to check. It is not legal advice and covers only what Codehouse sees.`,
    "",
    `${rows.length - gaps.length} of ${rows.length} control areas link to evidence; ${gaps.length} are gaps.`,
    "",
    "| Framework | Reference | Control area | Evidence |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.control.framework} | ${r.control.ref} | ${esc(r.control.title)} | ${r.gap ? "**Gap**" : esc(r.evidence.map((e) => `${e.name}: ${e.detail}`).join("; "))} |`),
    "",
    "## Gaps",
    "",
    ...(gaps.length ? gaps.map((r) => `- ${r.control.framework} ${r.control.ref}, ${r.control.title}: would be served by ${r.wouldServe}.`) : ["None."]),
    "",
  ].join("\n")
}
