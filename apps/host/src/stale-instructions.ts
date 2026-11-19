import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { withoutCredentials } from "./codehouse-action.js"
import { CONTEXT_FILES } from "./context-efficiency.js"

/**
 * D-082 (frontier, Insight and evidence): the stale instruction detector. What a project's CLAUDE.md or AGENTS.md
 * names in backticks is checked against the project as it is now:
 *   symbol   a name in code style (camelCase, PascalCase, SCREAMING_CASE, a call such as name()) that no code file
 *            contains any more; the commit that last added or removed it is named when git can find it quickly
 *   path     a file or folder that is not there
 *   script   `npm run x` where no package.json has a script x
 * A stale instruction tells every session something untrue, so each is listed with its file and line. It reads
 * files and git only.
 */
export interface Stale {
  file: string
  line: number
  term: string
  kind: "symbol" | "path" | "script"
  why: string
  changedIn?: string
}

const CODE = /\.(m|c)?[tj]sx?$|\.(py|cs|go|java|kt|rb|php|ps1|psm1|rs|swift)$/i
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|\.git|vendor)\//
const SYMBOL = /^([A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)(\(\))?$/
/** Looks like a name in code rather than a word: an inner capital, an underscore, or a call. */
const CODE_NAME = (name: string, call: boolean) => call || /[a-z][A-Z]/.test(name) || /^[A-Z][a-z]+[A-Z]/.test(name) || /^[A-Z0-9]+_[A-Z0-9_]+$/.test(name) || /[a-z]_[a-z]/.test(name)
const PATHY = /^(\.{0,2}\/)?[\w@.-]+(\/[\w@.-]+)+\/?$|^[\w-]+\.(ts|tsx|js|mjs|cjs|json|md|ps1|cs|py|ya?ml|toml|sh|css|html)$/

function git(cwd: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, windowsHide: true, timeout, maxBuffer: 1024 * 1024, env: withoutCredentials(process.env) }, (e, out) => (e ? reject(e) : resolve(String(out)))),
  )
}

/** Every identifier in the project's code files, from the files git lists. */
export function codeWords(root: string, files: string[]): Set<string> {
  const words = new Set<string>()
  for (const f of files.filter((x) => CODE.test(x) && !SKIP.test(x)).slice(0, 8000))
    try {
      const abs = path.join(root, f)
      if (fs.statSync(abs).size > 1_000_000) continue
      for (const m of fs.readFileSync(abs, "utf8").matchAll(/[A-Za-z_$][\w$]*/g)) words.add(m[0])
    } catch {
      // gone since
    }
  return words
}

/** The npm scripts of every package.json git lists. */
function npmScripts(root: string, files: string[]): Set<string> {
  const out = new Set<string>()
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x) && !SKIP.test(x)))
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, f), "utf8")) as { scripts?: Record<string, unknown> }
      for (const k of Object.keys(pkg.scripts ?? {})) out.add(k)
    } catch {
      // unreadable
    }
  return out
}

/** The stale mentions in the project's instruction files. `files` is the project's file list as git gives it. */
export async function staleInstructions(root: string, files: string[], o: { lookUpChanges?: number } = {}): Promise<Stale[]> {
  const words = codeWords(root, files)
  const scripts = npmScripts(root, files)
  const out: Stale[] = []
  for (const file of CONTEXT_FILES) {
    let text: string
    try {
      text = fs.readFileSync(path.join(root, file), "utf8")
    } catch {
      continue
    }
    let fenced = false
    text.split(/\r?\n/).forEach((l, i) => {
      if (/^\s*```/.test(l)) fenced = !fenced
      if (fenced) return
      for (const m of l.matchAll(/`([^`\n]{2,120})`/g)) {
        const term = m[1]!.trim()
        const at = { file, line: i + 1, term }
        const run = /^npm run ([\w:.-]+)/.exec(term)
        if (run) {
          if (scripts.size && !scripts.has(run[1]!)) out.push({ ...at, kind: "script", why: `No package.json here has a script called ${run[1]}.` })
          continue
        }
        if (/[\s<>*%~${}]|^[a-z]:|^\/|:\/\//i.test(term)) continue
        if (PATHY.test(term)) {
          const rel = term.replace(/^\.\//, "").replace(/\/$/, "")
          // A bare file name may live anywhere in the project.
          const found = rel.includes("/") ? fs.existsSync(path.join(root, rel)) : files.some((f) => f === rel || f.endsWith(`/${rel}`))
          if (!found) out.push({ ...at, kind: "path", why: rel.includes("/") ? `There is no ${rel} in the project.` : `No file called ${rel} is in the project.` })
          continue
        }
        const s = SYMBOL.exec(term)
        if (!s) continue
        const name = s[2]!
        if (!CODE_NAME(name, !!s[3]) || words.has(name)) continue
        out.push({ ...at, kind: "symbol", why: `No code file in the project contains ${name} any more.` })
      }
    })
  }
  // Where git can say quickly, the commit that last added or removed each missing name.
  for (const s of out.filter((x) => x.kind === "symbol").slice(0, o.lookUpChanges ?? 5)) {
    const name = SYMBOL.exec(s.term)![2]!
    // In the code, not in the instructions that still name it.
    const got = await git(root, ["log", "-S", name, "-1", "--format=%h %s", "--", ".", ...CONTEXT_FILES.map((f) => `:(exclude)${f}`)]).catch(() => "")
    if (got.trim()) s.changedIn = got.trim().slice(0, 200)
  }
  return out
}
