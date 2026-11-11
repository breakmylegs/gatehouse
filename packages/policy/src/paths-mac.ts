// Mac fork: paths on a Mac in the policy. Upstream only knows Windows paths, so a remembered file rule could not be made
// or loaded on a Mac. Kept out of upstream's files; the hooks are marked "Mac fork" (see docs/mac.md).

/**
 * A local absolute path a remembered file rule may name: C:\... or C:/... on Windows, /... (not the bare root) on a
 * Mac. Network (\\server) and device (\\?\) paths are neither.
 */
export function isLocalAbsolute(p: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" ? /^\/[^/]/.test(p) : /^[a-zA-Z]:[\\/]/.test(p)
}
