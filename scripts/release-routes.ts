import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * O60 (owner, 27 Nov): where the update routes file is looked for, in order: this checkout, the main worktree (a release
 * from a worktree finds the one in C:\dev\gatehouse, so it is never copied in and deleted by hand), then beside the
 * release key. It is git-ignored in every checkout and never committed; this only reads it.
 */
export function routesFiles(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const files = [path.join(root, "release-channels.local.json")]
  const main = mainWorktree(root)
  if (main && path.resolve(main) !== path.resolve(root)) files.push(path.join(main, "release-channels.local.json"))
  files.push(path.join(env.USERPROFILE ?? env.HOME ?? "", ".codehouse-release", "channels.json"))
  return files
}

/** The main worktree of the repository `root` is in: the folder its common git directory belongs to. */
export function mainWorktree(root: string): string | undefined {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8", windowsHide: true }).trim()
    // The common directory of a normal repository is <main>/.git; a bare one has no worktree of its own.
    return path.basename(common) === ".git" ? path.dirname(common) : undefined
  } catch {
    return undefined
  }
}

/** The first routes file that is there, or undefined. */
export function findRoutesFile(root: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return routesFiles(root, env).find((f) => fs.existsSync(f))
}
