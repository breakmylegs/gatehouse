// Mac fork: what a full folder path is on a Mac. Upstream only knows Windows paths (C:\dev\shop), so on a Mac it refused
// every project folder, routine and board card, and the projects folder could not be set, leaving no workspace at
// all. Kept out of upstream's files so its changes merge cleanly; the hooks are marked "Mac fork" (see docs/mac.md).

/**
 * A projects folder on a Mac: a full path below the root, not a system folder (/System, /Library, /Applications,
 * /usr and the like), not the bare /Volumes, and with no ".." in it. /Users/you/dev and /Volumes/Work/dev are fine.
 */
export const MAC_PROJECTS_FOLDER =
  /^\/(?!(system|library|applications|usr|bin|sbin|etc|private|var|dev|cores|network)(\/|$))(?!volumes\/?$)(?!.*(^|\/)\.\.(\/|$))[^\u0000-\u001f]+$/i

const WINDOWS_FULL = /^[A-Za-z]:[\\/]/
const MAC_FULL = /^\/[^/]/

/** A full folder path for this system: C:\... on Windows, /... (not the bare root) on a Mac. */
export function isFullFolder(p: string, platform: NodeJS.Platform = process.platform): boolean {
  return (platform === "darwin" ? MAC_FULL : WINDOWS_FULL).test(p)
}

/** An example folder for messages: C:\dev\shop on Windows, /Users/you/dev/shop on a Mac. */
export function folderExample(name: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? `/Users/you/dev/${name}` : `C:\\dev\\${name}`
}
