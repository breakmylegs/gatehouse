/**
 * D-009, the done-claim verifier (Frontier build, Wave 1). A reply that says the work is done ("the tests pass", "the
 * build succeeds", "fixed", "all green") is checked: Codehouse finds the command the claim rests on (from the turn's
 * own commands, or the project's) and runs it again itself, as a Codehouse action (section 6). The claim is stamped
 * Verified (it passed), Contradicted (it failed) or Unverified (nothing to run, or it could not be run).
 */
import fs from "node:fs"
import path from "node:path"

export type ClaimKind = "tests" | "build" | "lint" | "typecheck" | "fixed"
export type ClaimOutcome = "verified" | "contradicted" | "unverified"

export interface Claim {
  kind: ClaimKind
  /** The sentence it was said in, cut short. */
  quote: string
}

const CLAIMS: Array<[ClaimKind, RegExp]> = [
  ["tests", /\b(?:all (?:the |of the )?)?tests? (?:now |all |still )?(?:pass(?:es|ed|ing)?|are (?:now )?passing|are green)\b|\ball green\b|\b(?:test )?suite (?:now )?passes\b/i],
  ["build", /\bbuild (?:now )?(?:succeeds|succeeded|passes|passed|is green|works)\b|\bbuilds (?:cleanly|successfully)\b/i],
  ["lint", /\blint(?:ing|er)? (?:is |now )?(?:clean|passes|passed)\b|\bno lint (?:errors|warnings)\b/i],
  ["typecheck", /\btype ?-?check(?:s|ing|er)? (?:is |now )?(?:clean|passes|passed)\b|\bno type errors\b/i],
  ["fixed", /\b(?:is|are|now|has been|have been|it's|that's) (?:now )?fixed\b|\bfixed (?:it|the bug|the issue|this)\b/i],
]

/** Words before a claim in its sentence that take it back: "not all tests pass", "tests pass except one". */
const UNSAID = /\b(?:not|n't|never|no longer|fail(?:s|ed|ing)?|except|but|until|once|when|if|should|will|would)\b/i

/** The claims a reply makes, one of each kind at most. */
export function findClaims(text: string): Claim[] {
  const out: Claim[] = []
  const sentences = text.split(/(?<=[.!?])\s+|\n+/)
  for (const [kind, re] of CLAIMS) {
    for (const s of sentences) {
      const m = re.exec(s)
      if (!m) continue
      if (UNSAID.test(s.slice(0, m.index)) || UNSAID.test(s.slice(m.index + m[0].length, m.index + m[0].length + 20).replace(/^[\s,]*/, "").split(/\s/)[0] ?? ""))
        continue
      out.push({ kind, quote: s.trim().slice(0, 200) })
      break
    }
  }
  return out
}

const RUNS: Record<Exclude<ClaimKind, "fixed">, RegExp> = {
  tests: /^(?:npm (?:run )?test|pnpm (?:run )?test|yarn test|npx (?:vitest|jest|mocha)|vitest|jest|mocha|pytest|python -m pytest|dotnet test|go test|cargo test|invoke-pester)\b/i,
  build: /^(?:npm run build|pnpm (?:run )?build|yarn build|npx tsc(?! --noEmit)|tsc(?! --noEmit)|dotnet build|cargo build|go build|msbuild)\b/i,
  lint: /^(?:npm run lint|pnpm (?:run )?lint|yarn lint|npx eslint|eslint|ruff(?: check)?|flake8|pylint|dotnet format --verify-no-changes)\b/i,
  typecheck: /^(?:npm run typecheck|pnpm (?:run )?typecheck|yarn typecheck|npx tsc --noEmit|tsc --noEmit|mypy|pyright)\b/i,
}

/**
 * The part of a shell line that runs the check, with the folder it was run in: "cd app && npm test 2>&1 | tail" gives
 * "npm test" in app. Only that part is run again, so a pipe's last command does not decide the outcome.
 */
export function checkIn(line: string, kind: Exclude<ClaimKind, "fixed">, cwd: string): { command: string; cwd: string } | undefined {
  let dir = cwd
  for (const part of line.split(/&&|;|\|\|/)) {
    const seg = (part.split("|")[0] ?? "").replace(/\s+\d?>&?\S*/g, "").trim()
    const cd = /^cd\s+(?:\/d\s+)?["']?([^"']+?)["']?$/i.exec(seg)
    if (cd) {
      dir = path.resolve(dir, cd[1]!)
      continue
    }
    if (RUNS[kind].test(seg)) return { command: seg, cwd: dir }
  }
  return undefined
}

/** The project's own command for a kind, from package.json, pyproject or a .NET project. */
export function projectCommand(root: string, kind: Exclude<ClaimKind, "fixed">): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> }
    const s = pkg.scripts ?? {}
    if (kind === "tests" && s.test && !/no test specified/.test(s.test)) return "npm test"
    if (kind !== "tests" && s[kind]) return `npm run ${kind}`
  } catch {
    // No package.json, or not one that can be read.
  }
  if (kind === "tests" && (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "pytest.ini"))))
    return "python -m pytest"
  const names = (() => {
    try {
      return fs.readdirSync(root)
    } catch {
      return []
    }
  })()
  if (names.some((n) => /\.(sln|csproj)$/i.test(n))) return kind === "tests" ? "dotnet test" : kind === "build" ? "dotnet build" : undefined
  return undefined
}

/** What a claim rests on: the last of the turn's commands that checks it, else the project's own; or nothing. */
export function commandFor(
  claim: Claim,
  turnCommands: string[],
  cwd: string,
  root: string,
): { command: string; cwd: string } | undefined {
  const kind = claim.kind === "fixed" ? "tests" : claim.kind
  for (const line of [...turnCommands].reverse()) {
    const c = checkIn(line, kind, cwd)
    if (c) return c
  }
  const p = projectCommand(root, kind)
  return p ? { command: p, cwd: root } : undefined
}

export const CLAIM_WORDS: Record<ClaimOutcome, string> = {
  verified: "Verified",
  contradicted: "Contradicted",
  unverified: "Unverified",
}
