/**
 * T-073 (t3code review, O31): clone and publish, the safe way. /clone and /publish put a request in the prompt box for
 * you to send; Claude runs git clone or gh repo create itself, so each goes through the floor and the Approver like
 * any other call (both reach the network and ask you in Manual mode). Codehouse never clones or publishes silently.
 */

/** A repository address /clone accepts: https or ssh, no spaces, no shell characters. */
const REPO = /^(https:\/\/[\w.-]+(:\d+)?\/[\w./~-]+|git@[\w.-]+:[\w./~-]+)$/

export function cloneRequest(url: string): string | undefined {
  const u = url.trim()
  if (!REPO.test(u) || u.length > 300) return undefined
  return `Clone ${u} into a new folder inside this one with git clone, then tell me what it is and how it is laid out. Do not run anything from it yet.`
}

export const PUBLISH_REQUEST =
  "Publish this folder to GitHub: if it is not a git repository yet, make one with a first commit; then create a private repository with gh repo create (named after this folder unless I said otherwise), push to it, and tell me its address. Do not make it public."
