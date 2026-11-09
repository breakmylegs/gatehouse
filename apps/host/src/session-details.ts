/**
 * O21 (owner, 9 Nov, with two screenshots): what the session details panel shows besides what the screen already has
 * (context, changes, background work): which computer, which repository and branch, and the connectors the session
 * has. Names and states only: never a server's address, command or settings, which can carry a secret.
 */
import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"

export interface Connector {
  name: string
  /** Claude Code's word for it: connected, pending, failed, needs-auth or disabled. */
  status: string
  /** In Codehouse's own process, a claude.ai connector through Anthropic, outside the process, or not known. */
  kind: "in-process" | "claude.ai" | "outside" | "unknown"
}

export interface SessionDetails {
  computer: string
  cwd: string
  repo?: { name: string; top: string; branch?: string }
  connectors: Connector[]
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, windowsHide: true, timeout: 5_000 }, (e, out) =>
      e ? reject(e) : resolve(String(out).trim()),
    ),
  )
}

/** The repository the folder is in, and its branch; nothing when it is in none or git cannot say. */
export async function repoOf(cwd: string): Promise<SessionDetails["repo"]> {
  try {
    const top = path.resolve(await git(cwd, ["rev-parse", "--show-toplevel"]))
    const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")
    return {
      name: path.basename(top),
      top,
      ...(branch && branch !== "HEAD" ? { branch } : {}),
    }
  } catch {
    return undefined
  }
}

/** Claude Code's list of MCP servers, as names, states and kinds; anything it does not expect is left out. */
export function connectorsOf(statuses: unknown): Connector[] {
  if (!Array.isArray(statuses)) return []
  const out: Connector[] = []
  for (const raw of statuses) {
    const s = (raw ?? {}) as { name?: unknown; status?: unknown; config?: unknown }
    if (typeof s.name !== "string" || !s.name) continue
    const type = ((s.config ?? {}) as { type?: unknown }).type
    out.push({
      name: s.name.slice(0, 120),
      status: typeof s.status === "string" ? s.status.slice(0, 40) : "unknown",
      kind:
        type === "sdk"
          ? "in-process"
          : type === "claudeai-proxy"
            ? "claude.ai"
            : type === "stdio" || type === "sse" || type === "http"
              ? "outside"
              : "unknown",
    })
  }
  return out
}

export async function sessionDetails(
  cwd: string,
  mcpStatus: () => Promise<unknown>,
): Promise<SessionDetails> {
  const [repo, statuses] = await Promise.all([repoOf(cwd), mcpStatus().catch(() => [])])
  return {
    computer: os.hostname(),
    cwd,
    ...(repo ? { repo } : {}),
    connectors: connectorsOf(statuses),
  }
}
