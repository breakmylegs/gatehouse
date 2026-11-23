/**
 * E-082, meeting notes to backlog (Expansion E5). From a meeting transcript in the project (plain text, a Teams or Zoom
 * .vtt, or an .srt), the decisions, the actions and the user stories with their acceptance criteria, each linked to
 * the line of the transcript it came from. It reads the words as they are written, with no model: a decision is a
 * line that says it is one (Decision:, Decided, Agreed, We agreed); an action says Action: or TODO:, or is a name "to"
 * do something; a story is "As a ..., I want ... so that ...", and its criteria are the Given, When, Then or AC lines
 * after it. Stories go into the requirement ledger (D-033) as draft requirements; the decisions and actions into a
 * meeting record beside the transcript. Nothing is written until you ask, and nothing already there is overwritten.
 */
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { readRequirements, REQUIREMENTS_DIR } from "./requirements.js"

export interface Source {
  file: string
  /** 1-based, in the transcript as it is on disk. */
  line: number
  text: string
}

export interface Story {
  title: string
  text: string
  criteria: Array<{ text: string; source: Source }>
  source: Source
}

export interface Extracted {
  decisions: Array<{ text: string; source: Source }>
  actions: Array<{ text: string; owner?: string; source: Source }>
  stories: Story[]
}

/** A transcript's lines with their numbers on disk, cue numbers and timings taken out, speakers kept. */
export function transcriptLines(text: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = []
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const t = raw.replace(/<\/?v(?:\s[^>]*)?>/g, (m) => (m.startsWith("</") ? "" : m.replace(/^<v\s*([^>]*)>$/, "$1: "))).trim()
      if (!t || /^WEBVTT\b/.test(t) || /^NOTE\b/.test(t) || /^\d+$/.test(t) || /^[\d:.,]+\s*-->\s*[\d:.,]+/.test(t)) return
      out.push({ line: i + 1, text: t })
    })
  return out
}

const SPEAKER = /^([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*){0,3}):\s+/
/** A decision, at the start of the line or of a sentence in it; the words after it. */
const DECISIONS = [/(?:^|[.!?]\s+)(?:decision|decided|agreed)\s*[:-]\s*(.+)$/i, /(?:^|[.!?]\s+)(?:we|the team)\s+(?:have\s+)?(?:agreed|decided)\s+(?:that\s+|to\s+)?(.+)$/i]
const ACTION = /^(?:action(?:\s+item)?|ap|todo|to do)\s*[:-]\s*/i
const OWNER_TO = /^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:to|will)\s+(\w.*)$/
const STORY = /^as an?\s+(.+?),?\s+i\s+(?:want|need|would like)\s+(?:to\s+)?(.+?)(?:,?\s+so\s+that\s+(.+?))?\.?$/i
const CRITERION = /^(?:[-*]\s*)?(?:(given|when|then|and)\b\s*(.*)|(?:ac|acceptance(?:\s+criteri(?:on|a))?)\s*\d*\s*[:-]\s*(.*))$/i

export function extract(file: string, text: string): Extracted {
  const decisions: Extracted["decisions"] = []
  const actions: Extracted["actions"] = []
  const stories: Story[] = []
  let story: Story | undefined
  for (const { line, text: raw } of transcriptLines(text)) {
    // "Decision:", "Action:" and the like are what a line says, not who said it.
    const named = SPEAKER.exec(raw)?.[1]
    const speaker = named && !/^(decision|decided|agreed|action(\s+item)?|ap|todo|ac|acceptance(\s+criteri(on|a))?|note)$/i.test(named) ? named : undefined
    const t = speaker ? raw.replace(SPEAKER, "").trim() : raw.trim()
    const source = { file, line, text: raw }
    const crit = CRITERION.exec(t)
    if (story && crit) {
      story.criteria.push({ text: crit[1] ? `${crit[1][0]!.toUpperCase()}${crit[1].slice(1).toLowerCase()} ${crit[2]!.trim()}` : crit[3]!.trim(), source })
      continue
    }
    const s = STORY.exec(t)
    if (s) {
      story = { title: s[2]!.replace(/\.$/, "").slice(0, 100), text: t, criteria: [], source }
      stories.push(story)
      continue
    }
    story = undefined
    const decided = DECISIONS.map((re) => re.exec(t)?.[1]).find(Boolean)
    if (decided) decisions.push({ text: decided.replace(/^./, (c) => c.toUpperCase()), source })
    else if (ACTION.test(t)) {
      const rest = t.replace(ACTION, "")
      const who = OWNER_TO.exec(rest)
      actions.push({ text: who ? who[2]! : rest, ...(who ? { owner: who[1]! } : {}), source })
    } else {
      const who = OWNER_TO.exec(t)
      // "Priya to send the notes": a name, then to, then a verb; "speaker: I will" is the speaker's.
      if (who && /^[a-z]+\b/.test(who[2]!)) actions.push({ text: who[2]!, owner: who[1]!, source })
      else if (speaker && /^I(?:'ll| will)\s+(\w.*)$/.test(t)) actions.push({ text: t.replace(/^I(?:'ll| will)\s+/, ""), owner: speaker, source })
    }
  }
  return { decisions, actions, stories }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item"
const link = (s: Source) => `${s.file}#L${s.line}`

/** The requirement files the stories become, and the meeting record; nothing is written. */
export function plan(root: string, transcript: string, x: Extracted): Array<{ file: string; text: string; exists: boolean }> {
  const taken = new Set(readRequirements(root).requirements.map((r) => r.id))
  const out: Array<{ file: string; text: string; exists: boolean }> = []
  for (const s of x.stories) {
    let id = `REQ-${slug(s.title)}`
    for (let n = 2; taken.has(id); n++) id = `REQ-${slug(s.title)}-${n}`
    taken.add(id)
    const file = path.posix.join(REQUIREMENTS_DIR.replace(/\\/g, "/"), `${id}.md`)
    const text = [
      "---",
      `id: ${id}`,
      `title: ${JSON.stringify(s.title)}`,
      "status: draft",
      `source: ${JSON.stringify(link(s.source))}`,
      "---",
      "",
      `# ${id}: ${s.title}`,
      "",
      s.text,
      "",
      `From the meeting: [${link(s.source)}](${path.posix.relative(path.posix.dirname(file), s.source.file)}#L${s.source.line}).`,
      "",
      "## Acceptance criteria",
      "",
      ...(s.criteria.length ? s.criteria.map((c) => `- ${c.text} ([line ${c.source.line}](${path.posix.relative(path.posix.dirname(file), c.source.file)}#L${c.source.line}))`) : ["- None were said in the meeting: add them before this is ready."]),
      "",
    ].join("\n")
    out.push({ file, text, exists: fs.existsSync(path.join(root, file)) })
  }
  const recordFile = transcript.replace(/\.(txt|vtt|srt|md)$/i, "") + ".notes.md"
  const rel = (s: Source) => `[line ${s.line}](${path.posix.relative(path.posix.dirname(recordFile), s.file)}#L${s.line})`
  out.push({
    file: recordFile,
    text: [
      `# Meeting notes: ${path.posix.basename(transcript)}`,
      "",
      "Drafted by Codehouse from the transcript's own words; each item links to its line.",
      "",
      "## Decisions",
      "",
      ...(x.decisions.length ? x.decisions.map((d) => `- ${d.text} (${rel(d.source)})`) : ["- None found."]),
      "",
      "## Actions",
      "",
      ...(x.actions.length ? x.actions.map((a) => `- ${a.owner ? `**${a.owner}**: ` : ""}${a.text} (${rel(a.source)})`) : ["- None found."]),
      "",
      "## Stories (in the requirement ledger as drafts)",
      "",
      ...(x.stories.length ? x.stories.map((s) => `- ${s.title} (${rel(s.source)})`) : ["- None found."]),
      "",
    ].join("\n"),
    exists: fs.existsSync(path.join(root, recordFile)),
  })
  return out
}

/** Writes what is planned, never over a file already there; returns what was written and what was left. */
export async function writePlan(root: string, files: Array<{ file: string; text: string }>): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = []
  const skipped: string[] = []
  for (const f of files) {
    const abs = path.resolve(root, f.file)
    const r = path.relative(root, abs)
    if (r.startsWith("..") || path.isAbsolute(r) || fs.existsSync(abs)) {
      skipped.push(f.file)
      continue
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    await writeFileAtomic(abs, f.text)
    written.push(f.file)
  }
  return { written, skipped }
}
