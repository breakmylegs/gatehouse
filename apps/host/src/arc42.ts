/**
 * D-048, the architecture review pack (Frontier build, Wave 3): an arc42 document for the project, every one of its
 * twelve sections present, each filled from what Codehouse already knows (the requirements, the architecture rules and
 * graph, the C4 diagrams, the ADRs, the fitness checks, the drift and the threat drafts), and a section with no source
 * marked as a gap with what would fill it.
 */
import fs from "node:fs"
import path from "node:path"
import type { Adr } from "./adr.js"
import type { Drift } from "./arch-view.js"
import type { ArchRules } from "./architecture.js"
import type { FitnessResult } from "./fitness.js"
import type { Requirement } from "./requirements.js"

export interface Arc42Input {
  project: string
  date: string
  requirements: Requirement[]
  rules?: ArchRules
  diagrams?: { context: string; container: string; component: string }
  adrs: Adr[]
  fitness?: FitnessResult
  drift?: Drift
  /** Files that say how it is deployed (a Dockerfile, a compose file, a pipeline). */
  deployment: string[]
  /** Draft threat entries (D-050) as Markdown. */
  threats: string[]
}

export const ARC42_SECTIONS = [
  "Introduction and Goals",
  "Architecture Constraints",
  "Context and Scope",
  "Solution Strategy",
  "Building Block View",
  "Runtime View",
  "Deployment View",
  "Crosscutting Concepts",
  "Architecture Decisions",
  "Quality Requirements",
  "Risks and Technical Debt",
  "Glossary",
] as const

const gap = (what: string) => `**Gap:** nothing in the project says this yet. ${what}`
const mermaid = (s: string) => ["```mermaid", s, "```"].join("\n")

/** The files in a project that say how it is deployed. */
export function deploymentFiles(root: string): string[] {
  const out: string[] = []
  for (const f of ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "Procfile", "fly.toml", "vercel.json", "netlify.toml", "azure-pipelines.yml", "serverless.yml", "app.yaml"])
    if (fs.existsSync(path.join(root, f))) out.push(f)
  for (const d of ["deploy", "infra", "k8s", "helm", "terraform", ".github/workflows"])
    if (fs.existsSync(path.join(root, d))) out.push(`${d}/`)
  return out
}

/** The pack, as Markdown, and which sections are gaps. */
export function arc42(o: Arc42Input): { markdown: string; gaps: string[] } {
  const gaps: string[] = []
  const live = o.adrs.filter((a) => !["superseded", "deprecated", "rejected"].includes(a.status))
  const body: Record<(typeof ARC42_SECTIONS)[number], string | undefined> = {
    "Introduction and Goals": o.requirements.length
      ? o.requirements.map((r) => `- **${r.id}** ${r.title}${r.status ? ` (${r.status})` : ""}`).join("\n")
      : undefined,
    "Architecture Constraints": o.rules
      ? [
          "From .codehouse/architecture.yml:",
          ...o.rules.layers.map((l) => `- Layer **${l.name}** (${l.globs.join(", ")}) may depend on ${o.rules!.allow[l.name] ? o.rules!.allow[l.name]!.join(", ") || "no other layer" : "any layer"}.`),
          ...o.rules.forbid.map((f) => `- ${f.fromGlobs ? `From ${f.fromGlobs.join(", ")}, ` : ""}never import ${f.text}${f.reason ? ` (${f.reason})` : ""}.`),
        ].join("\n")
      : undefined,
    "Context and Scope": o.diagrams ? mermaid(o.diagrams.context) : undefined,
    "Solution Strategy": live.length ? live.map((a) => `- ${a.title}${a.outcome ? `: ${a.outcome}` : ""}`).join("\n") : undefined,
    "Building Block View": o.diagrams ? [mermaid(o.diagrams.container), "", mermaid(o.diagrams.component)].join("\n") : undefined,
    "Runtime View": undefined,
    "Deployment View": o.deployment.length ? `It is deployed with: ${o.deployment.join(", ")}.` : undefined,
    "Crosscutting Concepts": o.rules?.forbid.length ? o.rules.forbid.map((f) => `- ${f.text} is not used${f.fromGlobs ? ` in ${f.fromGlobs.join(", ")}` : ""}${f.reason ? `: ${f.reason}` : ""}.`).join("\n") : undefined,
    "Architecture Decisions": live.length ? live.map((a) => `- [${a.title}](${a.file})`).join("\n") : undefined,
    "Quality Requirements": o.fitness?.checks.length ? o.fitness.checks.map((c) => `- ${c.title}: ${c.limit} (${c.ok ? "met" : `not met${c.detail ? `: ${c.detail}` : ""}`})`).join("\n") : undefined,
    "Risks and Technical Debt":
      (o.drift && o.drift.newModules.length + o.drift.newCrossings.length + o.drift.newCycles.length) || o.threats.length || o.fitness?.failed
        ? [
            ...(o.drift?.newCycles.map((c) => `- An import cycle: ${c.join(", ")}.`) ?? []),
            ...(o.drift?.newCrossings.map((e) => `- A new edge across layers: ${e}.`) ?? []),
            ...(o.drift?.newModules.map((m) => `- A module not yet approved: ${m}.`) ?? []),
            ...(o.fitness?.checks.filter((c) => !c.ok).map((c) => `- A fitness check fails: ${c.title}.`) ?? []),
            ...(o.threats.length ? ["", "Threat model drafts from the latest change:", "", ...o.threats] : []),
          ].join("\n")
        : undefined,
    Glossary: undefined,
  }
  const fill: Record<(typeof ARC42_SECTIONS)[number], string> = {
    "Introduction and Goals": "Add requirements to docs/requirements.",
    "Architecture Constraints": "Add layers and forbidden imports to .codehouse/architecture.yml.",
    "Context and Scope": "Open Architecture... once so the import graph is read.",
    "Solution Strategy": "Accept the session's decisions as ADRs (Decisions...).",
    "Building Block View": "Open Architecture... once so the import graph is read.",
    "Runtime View": "Describe the main scenarios (a sequence of what calls what), in docs or an ADR.",
    "Deployment View": "Add the deployment files (a Dockerfile, a compose file, a pipeline).",
    "Crosscutting Concepts": "Name forbidden imports, with their reasons, in .codehouse/architecture.yml.",
    "Architecture Decisions": "Accept ADRs into docs/adr.",
    "Quality Requirements": "Set limits in .codehouse/fitness.yml.",
    "Risks and Technical Debt": "Nothing is drifting, failing or newly exposed; approve the architecture to measure drift.",
    Glossary: "Add the project's terms, in docs or a requirement.",
  }
  const parts = [`# ${o.project}: architecture review (arc42)`, "", `Made by Codehouse on ${o.date} from the project's own files.`, ""]
  ARC42_SECTIONS.forEach((s, i) => {
    const text = body[s]
    if (!text) gaps.push(s)
    parts.push(`## ${i + 1}. ${s}`, "", text ?? gap(fill[s]), "")
  })
  return { markdown: parts.join("\n"), gaps }
}
