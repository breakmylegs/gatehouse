/**
 * Uplift phase 4 (owner, 17 Nov): people the owner invites, each with a role and, if chosen, only some computers.
 *   owner     everything, including the other owners; there is always at least one
 *   admin     everything but changing an owner: the server's settings, pairing, people
 *   approver  sees the board and the inbox and answers what waits; opens a computer to look, and its commands are
 *             answers only (allow, deny, answer a question)
 *   viewer    sees the board and opens a computer to look; sends nothing
 * An account from before roles is an owner. Every computer's own rules still decide whatever CNW sends.
 */
export const ROLES = ["owner", "admin", "approver", "viewer"] as const
export type Role = (typeof ROLES)[number]

export const roleOf = (r: unknown): Role => (ROLES as readonly string[]).includes(String(r)) ? (r as Role) : "owner"

/** What each role may do in CNW's own pages and routes. */
const ALLOWED: Record<Role, ReadonlySet<string>> = {
  owner: new Set(["view", "answer", "command", "pair", "unpair", "allowlist", "update", "server", "people", "owners", "severe-approve"]),
  admin: new Set(["view", "answer", "command", "pair", "unpair", "allowlist", "update", "server", "people", "severe-approve"]),
  approver: new Set(["view", "answer", "severe-approve"]),
  viewer: new Set(["view"]),
}

export const roleMay = (role: Role, action: string): boolean => ALLOWED[role].has(action)

/** The commands an approver's tab may send a computer: answers, never prompts, settings or the kill switch's re-arm. */
const ANSWERS = new Set(["approve", "deny", "answer"])

/** Whether a command from a computer's page may go to it, for this role. */
export function commandAllowed(role: Role, data: unknown): boolean {
  if (roleMay(role, "command")) return true
  if (!roleMay(role, "answer")) return false
  const type = data && typeof data === "object" ? (data as { type?: unknown }).type : undefined
  return typeof type === "string" && ANSWERS.has(type)
}

/** A computer's own API through CNW: a viewer or an approver only reads it. */
export const httpAllowed = (role: Role, method: string): boolean => roleMay(role, "command") || method === "GET" || method === "HEAD"

/** Whether a person sees a computer: every one, unless the owner chose some. */
export const seesComputer = (computers: string[] | undefined, id: string): boolean => !computers || computers.includes(id)
