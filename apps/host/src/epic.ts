/**
 * E-062, epic decomposition (Expansion E5). From a brief, the session returns the epic's stories as a structured result
 * (E-052: a title, acceptance criteria and the stories it depends on, for each), and Codehouse writes each story into the
 * requirement ledger (D-033, docs/requirements) with a stable id: the epic's key and a short hash of the story's title,
 * so decomposing the same epic again keeps each story's id (and its links) whatever order the stories come in. Where
 * the project has enough history (D-100), each story carries the estimate per change, as an interval with its sample
 * size; with fewer than five samples it says so. A story already in the ledger is not overwritten.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { Estimate } from "./outcomes.js"
import { REQUIREMENTS_DIR } from "./requirements.js"

export const STORY_SCHEMA = {
  type: "object",
  required: ["stories"],
  properties: {
    stories: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        required: ["title", "criteria"],
        properties: {
          title: { type: "string", minLength: 3, maxLength: 160 },
          story: { type: "string", maxLength: 2000 },
          criteria: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 3, maxLength: 400 } },
          dependsOn: { type: "array", maxItems: 10, items: { type: "string", maxLength: 160 } },
        },
      },
    },
  },
} as const

export interface StoryInput {
  title: string
  story?: string
  criteria: string[]
  /** Titles of stories it depends on. */
  dependsOn?: string[]
}

/** The epic's key: its words' initials, upper case, at most six letters (EPIC when none). */
export function epicKey(epic: string): string {
  const k = epic
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 6)
  return k || "EPIC"
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/** A story's stable id: the epic's key and four hex characters of its normalised title. */
export const storyId = (epic: string, title: string) => `${epicKey(epic)}-${crypto.createHash("sha256").update(norm(title)).digest("hex").slice(0, 4).toUpperCase()}`

export const epicPrompt = (epic: string, brief: string) =>
  `Break this epic into user stories small enough to build and test one at a time. For each: a short title, the story ("As a ..., I want ..., so that ..."), testable acceptance criteria (EARS wording is welcome), and the titles of the stories it depends on. Do not build anything yet.\n\nEpic: ${epic.trim()}\n\nBrief:\n${brief.trim()}`

const money = (n: number) => `$${n.toFixed(2)}`

export function estimateLine(e: Estimate | undefined): string {
  if (!e || !e.enough || !e.costUsd) return `Not enough history for an estimate yet (${e?.samples ?? 0} sample${e?.samples === 1 ? "" : "s"}; five are needed).`
  const time = e.minutes ? `, ${e.minutes.low} to ${e.minutes.high} minutes` : ""
  return `About ${money(e.costUsd.low)} to ${money(e.costUsd.high)} per change${time}, from ${e.samples} samples of this project's history.`
}

export interface WrittenStory {
  id: string
  title: string
  file: string
  dependsOn: string[]
  written: boolean
}

/** Writes each story into the ledger with its stable id; a story already there is left as it is. */
export function writeStories(root: string, epic: string, stories: StoryInput[], estimate?: Estimate): WrittenStory[] {
  const dir = path.join(root, REQUIREMENTS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const idOf = new Map(stories.map((s) => [norm(s.title), storyId(epic, s.title)]))
  return stories.map((s) => {
    const id = idOf.get(norm(s.title))!
    const deps = (s.dependsOn ?? []).map((t) => idOf.get(norm(t)) ?? `(${t}, not a story of this epic)`)
    const file = path.join(dir, `${id}.md`)
    const rel = path.relative(root, file).replace(/\\/g, "/")
    if (fs.existsSync(file)) return { id, title: s.title, file: rel, dependsOn: deps, written: false }
    const body = [
      "---",
      `id: ${id}`,
      `title: ${JSON.stringify(s.title)}`,
      `epic: ${JSON.stringify(epic)}`,
      "status: proposed",
      ...(deps.length ? [`dependsOn: [${deps.map((d) => JSON.stringify(d)).join(", ")}]`] : []),
      "---",
      "",
      `# ${s.title}`,
      "",
      ...(s.story ? [s.story.trim(), ""] : []),
      "## Acceptance criteria",
      "",
      ...s.criteria.map((c) => `- ${c.trim()}`),
      "",
      "## Estimate",
      "",
      estimateLine(estimate),
      "",
    ].join("\n")
    fs.writeFileSync(`${file}.tmp`, body)
    fs.renameSync(`${file}.tmp`, file)
    return { id, title: s.title, file: rel, dependsOn: deps, written: true }
  })
}
