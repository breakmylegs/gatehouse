/**
 * Mac fork, O-MAC-1 (owner, 13 Nov): the critical-paths floor on a Mac. Windows' rule names C:/Windows and the program
 * folders, and refuses any call that names a path in them; a Mac's own folders are named in everyday reads
 * (cat /etc/hosts, /usr/bin/git), so here only a change is refused: an Edit, Write, MultiEdit or NotebookEdit, or a
 * shell command that writes there (a redirect, the last argument of cp, mv, ln and the like, the arguments of rm, tee,
 * mkdir, touch, chmod and the like, sed -i), looking through sudo, env and the other wrappers. Every mode, whatever
 * any rule says, as the floor is. Protected:
 *   - macOS and the system: /System, /Library, /usr (not /usr/local), /bin, /sbin, /etc and /private/etc, /Applications;
 *   - what starts by itself: ~/Library/LaunchAgents and the shell's start-up files.
 * Homebrew's folders (/opt/homebrew, /usr/local) are yours and are not. floor.ts calls this (see docs/mac.md).
 */
import path from "node:path"
import { COPIERS, SHELL_EDITORS, redirectTargets } from "./config-tamper.js"
import type { FloorHit } from "./floor.js"
import { baseCommandName, unwrapVariants, type Segment } from "./segments.js"
import type { ToolCall } from "./types.js"

export const MAC_CRITICAL_RULE = "critical-paths"
const MESSAGE =
  "macOS's own folders, the Applications folder, and what starts by itself at login or in every Terminal are never changed by a session. Instead, work inside the project folder, and ask the person if something there needs changing."

/** Folders a session never changes, below the root. */
const SYSTEM = ["system", "library", "usr", "bin", "sbin", "etc", "private/etc", "applications"]
/** Below your home folder: what runs by itself, at login or in every shell. */
const AUTO_START_DIRS = ["library/launchagents"]
const AUTO_START_FILES = [".zshrc", ".zprofile", ".zshenv", ".zlogin", ".bash_profile", ".bashrc", ".profile"]

/** Commands that write to every path they are given, and those that write only to their last. */
const MAC_WRITERS = /^(mkdir|touch|chmod|chown|chgrp|chflags|xattr|rmdir|unlink|truncate)$/
const MAC_COPIERS = /^(ln|install|rsync|ditto|scp)$/

const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])

/** A protected path, as a reason, or undefined. Lower case: a Mac's disk ignores case. */
function protectedPath(raw: string, cwd: string, home: string): string | undefined {
  const expanded = raw
    .replace(/^~(?=\/|$)/, home)
    .replace(/^\$\{?HOME\}?(?=\/|$)/, home)
    .replace(/^["']|["']$/g, "")
  const p = path.posix.resolve(cwd, expanded).toLowerCase()
  const h = path.posix.resolve(home).toLowerCase()
  const under = (dir: string) => p === dir || p.startsWith(`${dir}/`)
  if (under("/usr/local")) return undefined
  if (SYSTEM.some((d) => under(`/${d}`))) return raw
  if (AUTO_START_DIRS.some((d) => under(`${h}/${d}`))) return raw
  if (AUTO_START_FILES.some((f) => p === `${h}/${f}`)) return raw
  return undefined
}

const hit = (target: string): FloorHit => ({
  outcome: "deny",
  ruleId: MAC_CRITICAL_RULE,
  reason: `${MESSAGE} (it changes ${target})`,
})

/** The paths one command writes, by its name and arguments. */
function writes(name: string, args: string[]): string[] {
  const plain = args.filter((a) => !a.startsWith("-"))
  if (COPIERS.test(name) || MAC_COPIERS.test(name)) return plain.slice(-1)
  if (SHELL_EDITORS.test(name) || MAC_WRITERS.test(name)) return plain
  if ((name === "sed" || name === "perl") && args.some((a) => /^-[a-z]*i/.test(a))) return plain
  return []
}

/** A change to a protected Mac folder, or null. Only on a Mac; `platform` and `home` are for tests. */
export function macCriticalWrite(
  call: ToolCall,
  segments: Segment[],
  cwd: string,
  o: { platform?: NodeJS.Platform; home?: string } = {},
): FloorHit | null {
  if ((o.platform ?? process.platform) !== "darwin") return null
  const home = o.home ?? process.env.HOME ?? "/Users/you"
  const input = (call.input ?? {}) as Record<string, unknown>
  if (FILE_TOOLS.has(call.toolName)) {
    const raw = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : ""
    const target = raw && protectedPath(raw, cwd, home)
    return target ? hit(target) : null
  }
  const command = typeof input.command === "string" ? input.command : ""
  for (const t of redirectTargets(command)) {
    const target = protectedPath(t, cwd, home)
    if (target) return hit(target)
  }
  for (const seg of segments)
    for (const variant of unwrapVariants(seg)) {
      const [name = "", ...args] = variant.split(" ")
      for (const a of writes(baseCommandName(name), args)) {
        const target = protectedPath(a, cwd, home)
        if (target) return hit(target)
      }
    }
  return null
}
