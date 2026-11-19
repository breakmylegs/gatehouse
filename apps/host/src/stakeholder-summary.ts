import type { EvidencePack } from "./evidence.js"

/**
 * D-099 (frontier, Insight and evidence): a summary of a change for people who did not watch it, made only from its
 * evidence pack (D-003), with the business capabilities it touches (D-047). Every sentence names the evidence it rests
 * on: the pack, and the audit records or the part of the pack it comes from. What Claude claimed that Codehouse could
 * not confirm (a claim Unverified or Contradicted, an assumption not yet verified) is not stated: it is withheld and
 * listed, with why. The words come from the pack alone, never from Claude's replies, and the whole is redacted.
 */
export interface Sentence {
  text: string
  /** What it rests on: never empty. */
  evidence: string
}
export interface Withheld {
  text: string
  why: string
}
export interface StakeholderSummary {
  sentences: Sentence[]
  withheld: Withheld[]
  markdown: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const seqs = (xs: Array<{ seq: number }>) => (xs.length ? `audit record${xs.length === 1 ? "" : "s"} ${xs.slice(0, 8).map((x) => x.seq).join(", ")}${xs.length > 8 ? " and more" : ""}` : "")

interface Claim {
  kind?: string
  quote?: string
  outcome?: string
  why?: string
  command?: string
  flaky?: boolean
}

/** The summary of a pack. `redact` is applied to every sentence. */
export function stakeholderSummary(pack: EvidencePack, sha: string, redact: (s: string) => string): StakeholderSummary {
  const ref = `evidence pack ${sha.slice(0, 12)}`
  const sentences: Sentence[] = []
  const withheld: Withheld[] = []
  const say = (text: string, evidence: string) => sentences.push({ text: redact(text), evidence: redact(evidence ? `${ref}, ${evidence}` : ref) })

  const added = pack.files.reduce((a, f) => a + f.added, 0)
  const removed = pack.files.reduce((a, f) => a + f.removed, 0)
  if (pack.files.length)
    say(
      `The change ${pack.range.commit ? `(commit ${pack.range.commit.slice(0, 10)}) ` : ""}touches ${plural(pack.files.length, "file")}, adding ${plural(added, "line")} and removing ${removed}.`,
      "its files",
    )
  for (const c of pack.capabilities ?? [])
    say(`It changes the ${c.name} capability${c.owner ? `, owned by ${c.owner}` : ""} (${plural(c.files.length, "file")}).`, `its capabilities (${c.files.slice(0, 3).join(", ")})`)

  const byPerson = pack.decisions.filter((d) => d.decidedBy.startsWith("human"))
  const denied = pack.decisions.filter((d) => d.outcome === "deny")
  if (pack.decisions.length)
    say(
      `${plural(pack.decisions.length, "action")} needed a decision: ${byPerson.length} by a person, ${pack.decisions.length - byPerson.length} by the rules${denied.length ? `, and ${denied.length} ${denied.length === 1 ? "was" : "were"} refused` : ""}.`,
      seqs(pack.decisions),
    )

  const failed = pack.commands.filter((c) => c.result === "failed")
  if (pack.commands.length)
    say(`${plural(pack.commands.length, "command")} ran: ${pack.commands.length - failed.length} ended well and ${failed.length} failed.`, seqs(pack.commands))

  for (const c of pack.claims) {
    const claim = (c.claim ?? {}) as Claim
    const what = claim.quote ? `"${claim.quote.slice(0, 160)}"` : `a claim about ${claim.kind ?? "the work"}`
    if (claim.outcome === "verified")
      say(`Claude said ${what}, and Codehouse confirmed it${claim.command ? ` by running ${claim.command}` : ""}.`, seqs([c]))
    else
      withheld.push({
        text: redact(`Claude said ${what}`),
        why: redact(claim.outcome === "contradicted" ? `Codehouse found it untrue: ${claim.why ?? "its check failed"}` : `Codehouse could not confirm it: ${claim.why ?? "there was nothing to check it with"}`),
      })
  }
  if (pack.sealedChecks.runs) say(`${plural(pack.sealedChecks.runs, "sealed check")} the session could not see ran on it.`, seqs(pack.sealedChecks.records))

  const d = pack.dependencies
  if (d.added || d.changed || d.removed)
    say(`Dependencies: ${d.added} added, ${d.changed} changed, ${d.removed} removed.`, d.sbom ? `its SBOM ${d.sbom.slice(0, 12)}` : "its dependency changes")

  if (pack.findings.length) {
    const severe = pack.findings.filter((f) => f.severity === "Severe").length
    say(`The local analysis found ${plural(pack.findings.length, "issue")} in the added lines${severe ? `, ${severe} of them severe` : ""}.`, "its findings")
  } else if (pack.files.length) say("The local analysis found nothing in the added lines.", "its findings")

  for (const b of pack.budgets ?? []) say(`The ${b.name} performance budget was ${b.ok ? "met" : "not met"}.`, "its performance budgets")
  if (pack.fitness?.checks.length)
    say(`The project's fitness checks ${pack.fitness.failed ? `failed ${pack.fitness.failed} of ${pack.fitness.checks.length}` : "all held"} after the change.`, "its fitness checks")

  for (const a of pack.assumptions ?? []) withheld.push({ text: redact(`Claude assumed: ${a.text}`), why: "nobody has verified it yet" })

  const markdown = [
    "# What changed",
    "",
    ...sentences.map((s) => `- ${s.text} _(${s.evidence})_`),
    ...(withheld.length ? ["", "## Not stated: no evidence", "", ...withheld.map((w) => `- ${w.text}: ${w.why}.`)] : []),
    "",
    `Made by Codehouse from ${ref} only.`,
    "",
  ].join("\n")
  return { sentences, withheld, markdown }
}
