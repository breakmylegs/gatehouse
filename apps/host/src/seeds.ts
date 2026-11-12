/**
 * D-010, randomised check seeds (Frontier build, Wave 2). When Codehouse runs a test command again to check Claude's
 * claim (D-009), it gives the run a fresh seed, so a test that only passes for the one input it was written against
 * (a property test pinned to a seed, data made from a fixed random number) fails where it should. The seed goes in
 * CODEHOUSE_SEED for any test that reads it, and to the runner where Codehouse knows how: Vitest's --sequence.seed
 * (with --sequence.shuffle, so order is not relied on either) and Jest's --seed. It is recorded with the claim, so a
 * failure can be run again with the same seed.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/** A fresh seed, a positive 31-bit integer (what Vitest and Jest accept). */
export const freshSeed = () => crypto.randomInt(1, 2 ** 31 - 1)

export const seedEnv = (seed: number): Record<string, string> => ({ CODEHOUSE_SEED: String(seed) })

function testScript(cwd: string): string | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }
    return typeof j.scripts?.test === "string" ? j.scripts.test : undefined
  } catch {
    return undefined
  }
}

const VITEST = (seed: number) => `--sequence.seed=${seed} --sequence.shuffle`
const JEST = (seed: number) => `--seed=${seed}`

/**
 * The command with the seed passed to its runner, where Codehouse knows the runner: vitest and jest named in the
 * command, or behind npm test (from the project's test script). Anything else runs as it was, with the seed in its
 * environment only.
 */
export function seededCommand(command: string, cwd: string, seed: number): string {
  const c = command.trim()
  if (/\bseed[=\s]/.test(c)) return c
  if (/\bvitest\b/.test(c)) return `${c} ${VITEST(seed)}`
  if (/\bjest\b/.test(c)) return `${c} ${JEST(seed)}`
  if (/^(npm|pnpm|yarn)\s+(run\s+)?test\b/.test(c)) {
    const script = testScript(cwd) ?? ""
    const flags = /\bvitest\b/.test(script) ? VITEST(seed) : /\bjest\b/.test(script) ? JEST(seed) : undefined
    if (!flags) return c
    return c.includes(" -- ") ? `${c} ${flags}` : `${c} -- ${flags}`
  }
  return c
}
