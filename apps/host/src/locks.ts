/**
 * E-050, cross-session locks (Expansion E4). A lock table in the Host, for files, ports and named resources. A session
 * takes a file's lock when it first writes the file, and a port's when a command of its starts a server on it. Another
 * session's edit of a locked file, or its server on a locked port, goes to a person, naming the session that holds it;
 * a person can let it go ahead. A session's locks are released when it ends. Held in memory: they last as long as the
 * sessions do.
 */
import path from "node:path"
import { serverPort } from "./session-procs.js"

export const CROSS_LOCK_RULE = "cross-session-lock"

export type LockKind = "file" | "port" | "name"

export interface Lock {
  kind: LockKind
  name: string
  sessionId: string
  at: string
}

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

export class LockTable {
  readonly #locks = new Map<string, Lock>()

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  /** A file's name as the table keys it: absolute, and without case on Windows and the Mac. */
  fileName(file: string, cwd: string): string {
    const abs = path.resolve(cwd, file)
    return this.platform === "linux" ? abs : abs.toLowerCase()
  }

  #key = (kind: LockKind, name: string) => `${kind}:${name}`

  /** Takes a lock for a session; one another session holds is not taken (its holder is returned). */
  acquire(sessionId: string, kind: LockKind, name: string): { ok: true } | { ok: false; holder: Lock } {
    const k = this.#key(kind, name)
    const held = this.#locks.get(k)
    if (held && held.sessionId !== sessionId) return { ok: false, holder: held }
    if (!held) this.#locks.set(k, { kind, name, sessionId, at: new Date().toISOString() })
    return { ok: true }
  }

  /** Who else holds what a call would touch: the file an edit writes, or the port a command would serve on. */
  holderFor(sessionId: string, toolName: string, input: Record<string, unknown>, cwd: string): Lock | undefined {
    if (EDIT_TOOLS.has(toolName)) {
      const file = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : undefined
      if (!file) return undefined
      const l = this.#locks.get(this.#key("file", this.fileName(file, cwd)))
      return l && l.sessionId !== sessionId ? l : undefined
    }
    if ((toolName === "Bash" || toolName === "PowerShell") && typeof input.command === "string") {
      const port = serverPort(input.command)
      const l = port === undefined ? undefined : this.#locks.get(this.#key("port", String(port)))
      return l && l.sessionId !== sessionId ? l : undefined
    }
    return undefined
  }

  /** After a call went ahead: the session takes what it touched (a port it serves on). */
  tookCall(sessionId: string, toolName: string, input: Record<string, unknown>): void {
    if ((toolName === "Bash" || toolName === "PowerShell") && typeof input.command === "string") {
      const port = serverPort(input.command)
      if (port !== undefined) this.acquire(sessionId, "port", String(port))
    }
  }

  releaseSession(sessionId: string): number {
    let n = 0
    for (const [k, l] of this.#locks)
      if (l.sessionId === sessionId) {
        this.#locks.delete(k)
        n++
      }
    return n
  }

  release(sessionId: string, kind: LockKind, name: string): boolean {
    const k = this.#key(kind, name)
    if (this.#locks.get(k)?.sessionId !== sessionId) return false
    return this.#locks.delete(k)
  }

  list(): Lock[] {
    return [...this.#locks.values()].sort((a, b) => a.at.localeCompare(b.at))
  }
}

export const lockReason = (l: Lock, holderName: string) =>
  l.kind === "file"
    ? `Another session (${holderName}) is working on this file, so changing it here could undo or clash with its work. Allow it only if you mean both to change it.`
    : l.kind === "port"
      ? `Another session (${holderName}) is serving on port ${l.name}, so a second server there would clash. Allow it only if you have stopped the other one.`
      : `Another session (${holderName}) holds ${l.name}.`
