/**
 * T-006 (t3code review, O31): a scratch session, for trying something without naming a project. It is a new project
 * like any other, in your projects folder (so every rule and the workspace limits apply), in a dated folder with a few
 * random letters: scratch-2026-11-15-k3f9.
 */
export function scratchName(now: Date = new Date(), random: () => number = Math.random): string {
  const day = now.toISOString().slice(0, 10)
  const tail = Array.from({ length: 4 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(random() * 31)]).join("")
  return `scratch-${day}-${tail}`
}
