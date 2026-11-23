/**
 * E-055, agent handover notes (Expansion E4). A coding session writes a handover note with the Companion's
 * write_handover tool (the rule handover-tools allows it, from the Host's own in-process Companion only): where the work
 * stands, the next steps, the risks and the open questions, and the files it touched. Each file it names is checked
 * against the real change (the last commit against the working folder, untracked files included): one that has not
 * changed is marked, so a note cannot claim work that is not there. The next coding session started in that folder
 * receives the note, once, in its instructions. Notes are kept per folder in the data folder, the newest 20.
 */
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export interface HandoverInput {
  state: string
  next?: string[]
  risks?: string[]
  questions?: string[]
  files?: string[]
}

export interface HandoverNote {
  id: string
  sessionId: string
  at: string
  state: string
  next: string[]
  risks: string[]
  questions: string[]
  files: Array<{ path: string; changed: boolean }>
  /** The session that received it, once it has. */
  deliveredTo?: string
}

const git = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => execFile("git", ["-c", "core.quotePath=false", ...args], { cwd, windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => resolve(e ? undefined : String(out))))

/** The files the change touches: changed since the last commit, staged or not, and new files; relative, forward slashes. */
export async function changedFiles(root: string): Promise<Set<string> | undefined> {
  const diff = await git(root, ["diff", "--name-only", "HEAD"])
  if (diff === undefined) return undefined
  const untracked = (await git(root, ["ls-files", "--others", "--exclude-standard"])) ?? ""
  return new Set([...diff.split("\n"), ...untracked.split("\n")].map((l) => l.trim()).filter(Boolean).map((l) => l.toLowerCase()))
}

const rel = (root: string, f: string) => path.relative(root, path.resolve(root, f)).replace(/\\/g, "/")
const clip = (list: unknown, n: number, len: number) => (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, n).map((x) => x.trim().slice(0, len))

export class HandoverStore {
  constructor(readonly file: string) {}

  #all(): Record<string, HandoverNote[]> {
    try {
      return (JSON.parse(fs.readFileSync(this.file, "utf8")) as { folders?: Record<string, HandoverNote[]> }).folders ?? {}
    } catch {
      return {}
    }
  }
  #save(all: Record<string, HandoverNote[]>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, folders: all }, null, 1))
    fs.renameSync(`${this.file}.tmp`, this.file)
  }

  notes(folder: string): HandoverNote[] {
    return this.#all()[folder.toLowerCase()] ?? []
  }

  /** Keeps a note, each file it names checked against the change. */
  async write(folder: string, sessionId: string, input: HandoverInput): Promise<HandoverNote> {
    const changed = await changedFiles(folder)
    const note: HandoverNote = {
      id: crypto.randomBytes(4).toString("hex"),
      sessionId,
      at: new Date().toISOString(),
      state: input.state.trim().slice(0, 2000),
      next: clip(input.next, 15, 300),
      risks: clip(input.risks, 10, 300),
      questions: clip(input.questions, 10, 300),
      files: clip(input.files, 40, 300).map((f) => {
        const r = rel(folder, f)
        return { path: r, changed: !!changed?.has(r.toLowerCase()) }
      }),
    }
    const all = this.#all()
    all[folder.toLowerCase()] = [...(all[folder.toLowerCase()] ?? []), note].slice(-20)
    this.#save(all)
    return note
  }

  /** The newest note a new session in this folder has not received, written in the last 14 days; marked as received. */
  takeFor(folder: string, sessionId: string, now = Date.now()): HandoverNote | undefined {
    const all = this.#all()
    const list = all[folder.toLowerCase()] ?? []
    const note = [...list].reverse().find((n) => !n.deliveredTo && n.sessionId !== sessionId && now - Date.parse(n.at) < 14 * 86_400_000)
    if (!note) return undefined
    note.deliveredTo = sessionId
    this.#save(all)
    return note
  }
}

/** The note as the next session reads it. */
export function handoverText(n: HandoverNote): string {
  const list = (title: string, items: string[]) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join("\n")}` : "")
  const files = n.files.length ? `Files the last session named:\n${n.files.map((f) => `- ${f.path}${f.changed ? "" : " (NOT changed in the working folder: check before relying on this)"}`).join("\n")}` : ""
  return [
    `A handover note from the last session in this folder (${n.at.slice(0, 16).replace("T", " ")}). Read it before you start, and check it against the code: it is that session's account, not a fact.`,
    `Where it stands: ${n.state}`,
    list("Next steps", n.next),
    list("Risks", n.risks),
    list("Open questions for the person", n.questions),
    files,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** What the agent is told when it writes one, including any file it named that has not changed. */
export function handoverReply(n: HandoverNote): string {
  const unchanged = n.files.filter((f) => !f.changed).map((f) => f.path)
  return `Handover note ${n.id} kept; the next session in this folder receives it.${unchanged.length ? ` These files you named have not changed in the working folder, so the note marks them: ${unchanged.join(", ")}.` : ""}`
}

/** What every coding session is told, so a note is left before work stops. */
export const HANDOVER_HABIT = "Before you stop work in this folder, or when asked, leave a handover note with the write_handover tool for whoever works here next."

/** The prompt that asks a session for its note. */
export const HANDOVER_PROMPT =
  "Write a handover note now with the write_handover tool, for whoever works in this folder next: where the work stands, the next steps, the risks, the questions for the person, and the files you changed. Be specific and do not claim work you have not done."
