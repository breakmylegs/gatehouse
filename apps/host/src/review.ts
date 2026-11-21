import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { withoutCredentials } from "./codehouse-action.js"
import { addressProblem, chatOnce, type LocalRuntimeConfig } from "./providers/local-runtime.js"

/** The runtime or gateway on this computer that the reviewer is reached through, when Settings names a model listed there. */
export function reviewerRuntime(local: LocalRuntimeConfig | undefined, model: string | undefined): LocalRuntimeConfig | undefined {
  if (!local || !model || addressProblem(local.url)) return undefined
  return local.models.some((m) => m.name === model) ? local : undefined
}

/**
 * C-043, cross-model review through the gateway (Frontier build). A second model, reached only through the model runtime
 * or organisation gateway on 127.0.0.1 named in Settings (ADR 0010: no key or token leaves Codehouse), reads a
 * session's change and says what looks wrong. It is sent the diff against HEAD and nothing else, with the files the
 * floor keeps out (its secret globs) left out of the diff and the rest redacted, and it is offered no tools at all:
 * it can only answer in words. What it says is shown in the session's Review pane as findings; it decides nothing.
 */
export interface Finding {
  file?: string
  line?: number
  severity: "high" | "medium" | "low"
  text: string
}

export const MAX_DIFF = 60_000
const MAX_FINDINGS = 30

export const REVIEW_PROMPT = [
  "You review a code change for bugs, security problems and mistakes. You have no tools; answer only from the diff.",
  "Only point out real problems the diff shows, most serious first, at most 30.",
  'Answer with JSON only: {"findings":[{"file":"path","line":12,"severity":"high"|"medium"|"low","text":"one or two sentences"}]}.',
  'With nothing wrong, answer {"findings":[]}.',
].join(" ")

/** The model's answer as findings; an answer that cannot be read is said as one finding rather than dropped. */
export function readFindings(text: string): Finding[] {
  const m = /\{[\s\S]*\}/.exec(text)
  try {
    const j = JSON.parse(m?.[0] ?? "") as { findings?: unknown }
    if (!Array.isArray(j.findings)) throw new Error("no findings")
    return j.findings.slice(0, MAX_FINDINGS).flatMap((raw): Finding[] => {
      const f = (raw ?? {}) as Record<string, unknown>
      if (typeof f.text !== "string" || !f.text.trim()) return []
      const severity = f.severity === "high" || f.severity === "medium" || f.severity === "low" ? f.severity : "medium"
      return [
        {
          ...(typeof f.file === "string" && f.file.length <= 300 ? { file: f.file } : {}),
          ...(typeof f.line === "number" && Number.isInteger(f.line) && f.line > 0 ? { line: f.line } : {}),
          severity,
          text: f.text.trim().slice(0, 600),
        },
      ]
    })
  } catch {
    return [{ severity: "low", text: "The reviewer's answer could not be read as findings." }]
  }
}

/** The review of one diff. Everything the model is sent is redacted first; it is offered no tools. */
export async function reviewDiff(o: {
  diff: string
  runtime: { cfg: LocalRuntimeConfig; model: string }
  redact: (s: string) => string
  signal?: AbortSignal
  fetchFn?: typeof fetch
}): Promise<{ findings: Finding[]; truncated: boolean }> {
  const truncated = o.diff.length > MAX_DIFF
  const reply = await chatOnce(
    o.runtime.cfg,
    {
      model: o.runtime.model,
      messages: [
        { role: "system", content: REVIEW_PROMPT },
        { role: "user", content: o.redact(`The change:\n${o.diff.slice(0, MAX_DIFF)}${truncated ? "\n[the rest of the diff was left out]" : ""}`) },
      ],
      tools: [],
    },
    o.signal ?? AbortSignal.timeout(180_000),
    o.fetchFn,
  )
  return { findings: readFindings(reply.text), truncated }
}

/**
 * A session's change against HEAD, new files included, with the floor's secret files left out (git pathspec globs, as
 * checkpoints use). Built in a throw-away index, as checkpoints are, so your own index and files are never touched.
 */
export async function sessionDiff(cwd: string, secretGlobs: readonly string[]): Promise<string> {
  const excludes = secretGlobs.filter((g) => !/^(?:\/|[A-Za-z]:)/.test(g)).map((g) => `:(exclude,glob,icase)${g}`)
  const index = path.join(os.tmpdir(), `gh-review-${process.pid}-${crypto.randomUUID()}`)
  const env = { ...withoutCredentials(process.env), GIT_INDEX_FILE: index }
  const git = (args: string[]) =>
    new Promise<string>((resolve, reject) =>
      execFile("git", args, { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024, env }, (e, out) => (e ? reject(e) : resolve(String(out)))),
    )
  try {
    await git(["read-tree", "HEAD"])
    await git(["add", "-A", "--", ".", ...excludes])
    return await git(["diff", "--cached", "HEAD", "--no-color", "--no-ext-diff"])
  } catch {
    throw new Error("The change could not be read (is the folder a repository with a commit?).")
  } finally {
    fs.rmSync(index, { force: true })
  }
}
