/**
 * E-058, a release readiness report (Expansion E5). For a release candidate (the project's change since its default
 * branch), the report brings together: the evidence packs of its commits (D-003), the escalations still waiting in the
 * project, the sealed checks, the dependencies' vulnerabilities (D-057's snapshot) and licences (D-055), accessibility
 * (E-048's report) and the definition of done (E-057). It is ready only when nothing blocks: an open Severe escalation,
 * a failing sealed check, a known vulnerability, a licence not allowed, a new Serious accessibility violation or an unmet
 * definition of done each make it not ready, with the reason. What a project has not set up is said, and does not block.
 */
export interface ReadinessInput {
  pending: Array<{ risk: number; ruleId: string; toolName: string; reason: string }>
  /** The sealed checks: true or false when run; undefined when the project has none. */
  sealed?: boolean
  evidence: { commits: number; withPack: number }
  /** Known vulnerabilities in the dependencies; undefined when there is no snapshot to check against. */
  vulnerabilities?: string[]
  /** Licence problems; undefined when there is nothing to check. */
  licences?: string[]
  /** Accessibility; undefined when the project keeps no report. */
  a11y?: { pass: boolean; reason: string }
  dod?: { met: number; total: number; unmet: string[] }
}

export type SectionState = "ok" | "blocks" | "warn" | "not set up"

export interface Section {
  name: string
  state: SectionState
  detail: string
}

export interface Readiness {
  ready: boolean
  reasons: string[]
  sections: Section[]
}

export const SEVERE = 85

export function readiness(i: ReadinessInput): Readiness {
  const sections: Section[] = []
  const severe = i.pending.filter((p) => p.risk >= SEVERE)
  sections.push(
    severe.length
      ? { name: "Open escalations", state: "blocks", detail: `${severe.length} Severe escalation(s) still wait: ${severe.slice(0, 3).map((p) => `${p.toolName} (${p.ruleId}, risk ${p.risk}): ${p.reason}`).join("; ")}` }
      : i.pending.length
        ? { name: "Open escalations", state: "warn", detail: `${i.pending.length} escalation(s) still wait, none Severe.` }
        : { name: "Open escalations", state: "ok", detail: "None waiting." },
  )
  sections.push(i.sealed === undefined ? { name: "Sealed checks", state: "not set up", detail: "This project has no sealed checks." } : i.sealed ? { name: "Sealed checks", state: "ok", detail: "They pass." } : { name: "Sealed checks", state: "blocks", detail: "They fail." })
  sections.push(
    !i.evidence.commits
      ? { name: "Evidence packs", state: "warn", detail: "The candidate has no commits of its own." }
      : i.evidence.withPack === i.evidence.commits
        ? { name: "Evidence packs", state: "ok", detail: `All ${i.evidence.commits} commit(s) have one.` }
        : { name: "Evidence packs", state: "warn", detail: `${i.evidence.commits - i.evidence.withPack} of ${i.evidence.commits} commit(s) have none.` },
  )
  sections.push(i.vulnerabilities === undefined ? { name: "Vulnerabilities", state: "not set up", detail: "No vulnerability snapshot to check against." } : i.vulnerabilities.length ? { name: "Vulnerabilities", state: "blocks", detail: `Known in: ${i.vulnerabilities.slice(0, 8).join(", ")}${i.vulnerabilities.length > 8 ? `, and ${i.vulnerabilities.length - 8} more` : ""}.` } : { name: "Vulnerabilities", state: "ok", detail: "None known in the dependencies." })
  sections.push(i.licences === undefined ? { name: "Licences", state: "not set up", detail: "No dependencies to check." } : i.licences.length ? { name: "Licences", state: "blocks", detail: i.licences.slice(0, 5).join("; ") } : { name: "Licences", state: "ok", detail: "Every direct dependency's licence is allowed." })
  sections.push(i.a11y === undefined ? { name: "Accessibility", state: "not set up", detail: "The project keeps no accessibility report." } : { name: "Accessibility", state: i.a11y.pass ? "ok" : "blocks", detail: i.a11y.reason })
  sections.push(i.dod === undefined ? { name: "Definition of done", state: "not set up", detail: "The project has no definition of done." } : i.dod.unmet.length ? { name: "Definition of done", state: "blocks", detail: `${i.dod.met} of ${i.dod.total} met; not met: ${i.dod.unmet.join(", ")}.` } : { name: "Definition of done", state: "ok", detail: `All ${i.dod.total} met.` })
  const reasons = sections.filter((s) => s.state === "blocks").map((s) => `${s.name}: ${s.detail}`)
  return { ready: !reasons.length, reasons, sections }
}

/** The report as Markdown, to keep with the release. */
export function readinessMarkdown(r: Readiness, candidate: string): string {
  const mark = { ok: "OK", blocks: "BLOCKS", warn: "Check", "not set up": "Not set up" }
  return [
    `# Release readiness: ${candidate}`,
    "",
    r.ready ? "**Ready.** Nothing blocks the release." : `**Not ready.**\n\n${r.reasons.map((x) => `- ${x}`).join("\n")}`,
    "",
    "| Area | State | Detail |",
    "|---|---|---|",
    ...r.sections.map((s) => `| ${s.name} | ${mark[s.state]} | ${s.detail.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n")
}
