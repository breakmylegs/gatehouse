/**
 * Which platform each change is for (owner, 4 Nov: a Mac fork, not maintained here, pulls the newest features).
 * Every release says, for each change, whether it is for every platform, Windows only, or both with Windows parts,
 * worked out from the files its commit touched, and lists the commits in changes.json so a fork can pick the ones
 * it can use. See docs/forks.md.
 */
export type Platform = "all" | "windows" | "mixed" | "release" | "docs"

/** Windows-only parts: the C# shell, the installer and packaging, DPAPI, job-object limits, the folder picker, the updater. */
const WINDOWS = [
  /^packaging\//,
  /^scripts\/(dpapi\.ps1|installer\.mjs|installer-move-check\.mjs|package\.mjs|package-smoke\.mjs|install-local\.mjs|links\.mjs|ico\.mjs)$/,
  /^apps\/host\/src\/(limits|folder-picker)\.ts$/,
  /^apps\/host\/src\/relay\/protector\.ts$/,
  /^apps\/host\/src\/update\//,
  /^apps\/host\/test\/(limits-exe|hotkey-exe|updater-exe|update|limits-usage)\.test\.ts$/,
]
/** How this repository builds and publishes its own releases: nothing a fork's users run. */
const RELEASE = [
  /^scripts\/(release|platforms|update-e2e|update-route-e2e|perf-check|screenshots|artifact-sandbox-check)\.ts$/,
  /^scripts\/(gate|bundle)\.mjs$/,
  /^\.gitignore$/,
]
const DOCS = [/^docs\//, /\.md$/]

/** One file's kind. */
export function kindOf(file: string): "all" | "windows" | "release" | "docs" {
  const f = file.replace(/\\/g, "/")
  if (WINDOWS.some((r) => r.test(f))) return "windows"
  if (RELEASE.some((r) => r.test(f))) return "release"
  if (DOCS.some((r) => r.test(f))) return "docs"
  return "all"
}

/** A commit's platform from its files: Windows only, every platform, or both with Windows parts. */
export function platformOf(files: string[]): Platform {
  if (!files.length) return "all"
  const kinds = new Set(files.map(kindOf))
  if (kinds.has("windows") && kinds.has("all")) return "mixed"
  if (kinds.has("windows")) return "windows"
  if (kinds.has("all")) return "all"
  if (kinds.has("release")) return "release"
  return "docs"
}

export interface Change {
  commit: string
  subject: string
  platform: Platform
  files: string[]
}

/** git log with --format=%x1e%H%x1f%s --name-only, read into changes. */
export function parseLog(log: string): Change[] {
  return log
    .split("\x1e")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [head = "", ...rest] = block.split(/\r?\n/)
      const [commit = "", raw = ""] = head.split("\x1f")
      const files = rest.map((l) => l.trim()).filter(Boolean)
      const subject = raw.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "")
      return {
        commit,
        subject: subject.charAt(0).toUpperCase() + subject.slice(1),
        platform: platformOf(files),
        files,
      }
    })
}

const HEADINGS: Array<[Platform, string]> = [
  ["all", "For every platform"],
  ["mixed", "For every platform, with Windows parts"],
  ["windows", "Windows only"],
]

/** The "What is new" part of the notes, grouped by platform. Build, release and docs changes are left out. */
export function notesFor(changes: Change[]): string {
  const parts = HEADINGS.flatMap(([p, heading]) => {
    const list = changes.filter((c) => c.platform === p)
    return list.length ? [`### ${heading}`, "", ...list.map((c) => `- ${c.subject}`), ""] : []
  })
  return parts.join("\n").trim()
}
