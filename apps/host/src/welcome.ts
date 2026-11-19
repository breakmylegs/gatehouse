import fs from "node:fs"
import path from "node:path"

/**
 * T-004: what the welcome finds on this computer. The coding agents installed on the PATH (shown only: Codehouse runs
 * Claude through its own copy of Claude Code, and runs no other agent), the model runtimes answering on this computer
 * (127.0.0.1 only, never followed elsewhere, so Settings can offer them for chats). The welcome adds the projects of
 * your recent Claude Code conversations from the history Codehouse already reads. Nothing is copied or changed.
 */
export const AGENTS = [
  { id: "claude", name: "Claude Code", commands: ["claude"] },
  { id: "codex", name: "OpenAI Codex CLI", commands: ["codex"] },
  { id: "gemini", name: "Gemini CLI", commands: ["gemini"] },
  { id: "copilot", name: "GitHub Copilot CLI", commands: ["copilot"] },
  { id: "cursor", name: "Cursor agent", commands: ["cursor-agent"] },
  { id: "aider", name: "Aider", commands: ["aider"] },
  { id: "opencode", name: "opencode", commands: ["opencode"] },
  { id: "goose", name: "Goose", commands: ["goose"] },
] as const

export const RUNTIMES = [
  { kind: "ollama", name: "Ollama", url: "http://127.0.0.1:11434", probe: "/api/version" },
  { kind: "openai-compatible", name: "LM Studio", url: "http://127.0.0.1:1234", probe: "/v1/models" },
  { kind: "openai-compatible", name: "llama.cpp server", url: "http://127.0.0.1:8080", probe: "/v1/models" },
] as const

export interface FoundAgent {
  id: string
  name: string
  where?: string
}
export interface FoundRuntime {
  kind: string
  name: string
  url: string
  up: boolean
}
/** Where a command is on the PATH, or undefined. On Windows each PATHEXT extension is tried. */
export function findOnPath(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = isFile): string | undefined {
  const win = platform === "win32"
  const dirs = (env.PATH ?? env.Path ?? "").split(win ? ";" : ":").filter(Boolean)
  const exts = win ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [""]
  for (const d of dirs)
    for (const e of exts) {
      const p = (win ? path.win32 : path.posix).join(d.replace(/^"|"$/g, ""), command + e)
      if (exists(p)) return p
    }
  return undefined
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

export function findAgents(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, exists?: (p: string) => boolean): FoundAgent[] {
  return AGENTS.map((a) => {
    const where = a.commands.map((c) => findOnPath(c, env, platform, exists)).find(Boolean)
    return { id: a.id, name: a.name, ...(where ? { where } : {}) }
  })
}

/** Which runtimes answer on this computer, each asked once, briefly, never following a redirect. */
export async function findRuntimes(fetchFn: typeof fetch = fetch, timeoutMs = 1500): Promise<FoundRuntime[]> {
  return await Promise.all(
    RUNTIMES.map(async (r) => {
      let up = false
      try {
        const res = await fetchFn(`${r.url}${r.probe}`, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) })
        up = res.ok
      } catch {
        up = false
      }
      return { kind: r.kind, name: r.name, url: r.url, up }
    }),
  )
}
