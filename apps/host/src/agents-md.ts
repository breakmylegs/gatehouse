import fs from "node:fs"
import path from "node:path"
import { evaluateFloor, findProjectRoot, type Policy } from "@gatehouse/policy"

/** How much of AGENTS.md is passed on (B23): enough for any sensible one, never a whole document dump. */
export const MAX_AGENTS_MD = 20_000

/**
 * B23: a project's AGENTS.md, the instructions file other coding agents read, for a coding session. Claude Code reads
 * CLAUDE.md, so a project written for other agents would otherwise lose its instructions. Read only if the floor lets a
 * Read of it through, cut to MAX_AGENTS_MD, and skipped when CLAUDE.md already brings it in with @AGENTS.md. Undefined
 * when there is none, or anything goes wrong.
 */
export async function readAgentsMd(
  cwd: string,
  policy: Policy | undefined,
): Promise<string | undefined> {
  try {
    const root = findProjectRoot(cwd)
    const file = path.join(root, "AGENTS.md")
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined
    const claude = path.join(root, "CLAUDE.md")
    if (fs.existsSync(claude) && /@AGENTS\.md\b/i.test(fs.readFileSync(claude, "utf8")))
      return undefined
    // Through the floor, as a Read of it would be. Without a policy nothing is read.
    if (!policy) return undefined
    const hit = await evaluateFloor(
      policy,
      { toolName: "Read", input: { file_path: file } },
      { cwd: root },
    )
    if (hit) return undefined
    const text = fs.readFileSync(file, "utf8").trim()
    return text ? text.slice(0, MAX_AGENTS_MD) : undefined
  } catch {
    return undefined
  }
}
