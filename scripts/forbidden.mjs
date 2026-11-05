// CH-01 (owner's Chat build, 4 Nov 2026): fails when the tree holds something Anthropic's terms or Codehouse's rules
// forbid: claude.ai's private API, a browser debugging port, an automation library, a browser cookie store, or reading
// the Claude desktop app's own data. Run by npm run gate and npm run release (no GitHub Actions, owner 29 Oct).
//
//   node scripts/forbidden.mjs           every tracked file and every new file git does not ignore
//
// Documents are not checked: they quote these patterns to forbid them.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Each check, and the only files it does not apply to, each with the reason. */
export const CHECKS = [
  {
    id: "claude-private-api",
    why: "claude.ai's private API is never called",
    re: /claude\.ai\/api/i,
  },
  {
    id: "browser-debugging",
    why: "no browser is started with a debugging port or pipe",
    re: /remote-debugging-(port|pipe)/i,
    // These start a throwaway headless Edge on Codehouse's own local page to take screenshots and measure it.
    // They are build checks, never shipped, and the next check keeps them away from Anthropic's sites.
    except: [
      "scripts/screenshots.ts",
      "scripts/perf-check.ts",
      "scripts/artifact-sandbox-check.ts",
    ],
  },
  {
    id: "debugging-target",
    why: "a build check that drives a browser never points it at Anthropic's sites",
    re: /claude\.ai|anthropic\.com/i,
    only: ["scripts/screenshots.ts", "scripts/perf-check.ts", "scripts/artifact-sandbox-check.ts"],
  },
  {
    id: "browser-automation-flag",
    why: "no browser is started with an extension or automation flag",
    re: /--(load-extension|enable-automation)\b/i,
  },
  {
    id: "cookie-store",
    why: "no browser cookie store is read",
    re: /CookieManager\b/,
  },
  {
    id: "automation-library",
    why: "no browser automation or DevTools protocol library",
    re: /(\bfrom\s+|\brequire\(\s*|\bimport\(\s*)["'](puppeteer(-core)?|playwright(-core)?|@playwright\/test|selenium-webdriver|chrome-remote-interface|webdriverio|devtools-protocol)["']/,
  },
  {
    id: "automation-dependency",
    why: "no browser automation or DevTools protocol package",
    re: /"(node_modules\/)?(puppeteer(-core)?|playwright(-core)?|@playwright\/test|selenium-webdriver|chrome-remote-interface|webdriverio|devtools-protocol)"\s*:/,
    files: /(^|\/)package(-lock)?\.json$/,
  },
  {
    id: "claude-app-data",
    why: "the Claude desktop app's own data (its cookies, storage and sign-in) is never read",
    // The app's folders are spelt "Claude"; an added account's own "claude" folder under Gatehouse is not one of them.
    re: /(APPDATA|AppData|appdata)[^\n]{0,80}["'`\\/]Claude(-3p)?(["'`\\/]|$)|Roaming[\\/]+Claude\b|Claude-3p|Claude Desktop Import/m,
  },
]

const SELF = ["scripts/forbidden.mjs", "apps/host/test/forbidden.test.ts"]
const TEXT =
  /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|cs|ps1|psm1|iss|ya?ml|html|css|txt|cmd|bat|manifest|sh|toml|xml)$/i

/** Whether a file is checked at all: text that is not a document, not this check and not a skill's reference. */
export function checked(rel) {
  if (SELF.includes(rel)) return false
  if (/^(docs|\.claude)\//.test(rel) || /\.md$/i.test(rel)) return false
  return TEXT.test(rel)
}

/** Every finding in these files (paths relative to root, with forward slashes). */
export function scan(root, files) {
  const found = []
  for (const rel of files) {
    if (!checked(rel)) continue
    let text
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8")
    } catch {
      continue // deleted but not yet committed
    }
    for (const c of CHECKS) {
      if (c.except?.includes(rel)) continue
      if (c.only && !c.only.includes(rel)) continue
      if (c.files && !c.files.test(rel)) continue
      const m = c.re.exec(text)
      if (!m) continue
      const line = text.slice(0, m.index).split("\n").length
      found.push({ file: rel, line, id: c.id, why: c.why })
    }
  }
  return found
}

export function treeFiles(root) {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`git ls-files: ${r.stderr.trim()}`)
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const found = scan(root, treeFiles(root))
  for (const f of found) console.log(`${f.file}:${f.line}  ${f.id}: ${f.why}`)
  console.log(
    found.length
      ? `[forbidden] ${found.length} prohibited pattern${found.length === 1 ? "" : "s"} found`
      : "[forbidden] none found",
  )
  process.exit(found.length ? 1 : 0)
}
