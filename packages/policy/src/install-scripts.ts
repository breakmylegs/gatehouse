/**
 * D-064, install-script default deny (Frontier build, Wave 1). npm, pnpm, yarn and bun run a package's preinstall,
 * install and postinstall scripts, and the project's own prepare, on install, with the session's rights: the commonest
 * way a malicious package runs code. An agent's install that would run such a script goes to a person, the card shows
 * each script's text, and Extreme approval never approves it (canuse's NEVER_AUTO_APPROVED).
 *
 * The card offers "Run without scripts": the same command with --ignore-scripts after the install, sent as an edited
 * input, so it is checked again like any edited input (invariant 10). Nothing is rewritten silently.
 *
 * What is read, offline: the project's package.json, package-lock.json (hasInstallScript) and each named package's
 * package.json in node_modules. A package not on this computer yet cannot be read; D-053 already asks about it.
 */
import fs from "node:fs"
import path from "node:path"

export const INSTALL_SCRIPTS_RULE = "install-scripts"
const LIFECYCLE = ["preinstall", "install", "postinstall"] as const

export interface InstallScript {
  /** The package, or "this project" for its own scripts. */
  package: string
  script: string
  /** Its text, or undefined when the lockfile says it has one but the package is not here to read. */
  text?: string
}

export interface InstallScriptsFinding {
  ruleId: typeof INSTALL_SCRIPTS_RULE
  reason: string
  risk: number
  scripts: InstallScript[]
}

const readJson = (f: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const scriptsOf = (j: Record<string, unknown> | undefined): Record<string, string> => {
  const s = j?.scripts
  if (!s || typeof s !== "object") return {}
  return Object.fromEntries(Object.entries(s as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"))
}

/** The words of each command of a shell line, quotes taken off. */
const commandsOf = (line: string): string[][] =>
  line
    .split(/&&|\|\||[;|\n]/)
    .map((p) => [...p.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? ""))
    .filter((w) => w.length > 0)

const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"])
const INSTALLS = new Set(["install", "i", "add", "ci", "isntall", "in"])

/** An install command in the words, without --ignore-scripts: the packages it names (none for a bare install). */
function installOf(words: string[]): { named: string[] } | undefined {
  const [m, sub] = words.map((w) => w.toLowerCase())
  if (!m || !MANAGERS.has(m.replace(/\.(cmd|exe)$/, ""))) return undefined
  // yarn on its own installs.
  const bareYarn = m.startsWith("yarn") && (sub === undefined || sub.startsWith("-"))
  if (!bareYarn && !INSTALLS.has(sub ?? "")) return undefined
  if (words.some((w) => /^--ignore-scripts(=true)?$/i.test(w))) return undefined
  const named = words
    .slice(bareYarn ? 1 : 2)
    .filter((w) => !w.startsWith("-") && !/^[.~/\\]|^[a-zA-Z]:|:\/\//.test(w))
    .map((w) => /^(@[^/@\s]+\/[^@\s]+|[^@\s]+)/.exec(w)?.[1] ?? w)
  return { named }
}

/** The install scripts an install command would run, read from the project and node_modules. */
export function installScripts(command: string, cwd: string): InstallScript[] {
  const out: InstallScript[] = []
  for (const words of commandsOf(command)) {
    const inst = installOf(words)
    if (!inst) continue
    const lock = readJson(path.join(cwd, "package-lock.json"))
    const packages = (lock?.packages as Record<string, { hasInstallScript?: unknown }> | undefined) ?? {}
    const fromModules = (name: string) => {
      const s = scriptsOf(readJson(path.join(cwd, "node_modules", ...name.split("/"), "package.json")))
      const found = LIFECYCLE.filter((k) => s[k]).map((k) => ({ package: name, script: k, text: s[k] }))
      if (found.length) out.push(...found)
      else if (packages[`node_modules/${name}`]?.hasInstallScript === true) out.push({ package: name, script: "install" })
    }
    if (inst.named.length) for (const n of inst.named) fromModules(n)
    else {
      // A bare install: the project's own scripts, and every package the lockfile says has one.
      const own = scriptsOf(readJson(path.join(cwd, "package.json")))
      for (const k of [...LIFECYCLE, "prepare"] as const) if (own[k]) out.push({ package: "this project", script: k, text: own[k] })
      for (const [key, p] of Object.entries(packages))
        if (p?.hasInstallScript === true) {
          const name = /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key)?.[1]
          if (name) fromModules(name)
        }
    }
  }
  // Once each.
  return out.filter((x, i) => out.findIndex((y) => y.package === x.package && y.script === x.script) === i)
}

/** The finding for a shell command, or undefined when it runs no install script. */
export function installScriptsFinding(command: string, cwd: string): InstallScriptsFinding | undefined {
  const scripts = installScripts(command, cwd)
  if (!scripts.length) return undefined
  const list = scripts
    .slice(0, 6)
    .map((s) => `${s.package} ${s.script}: ${s.text ? `"${s.text.slice(0, 160)}"` : "(the lockfile says it has one; it is not on this computer to read)"}`)
    .join("; ")
  return {
    ruleId: INSTALL_SCRIPTS_RULE,
    reason: `This install would run install scripts with your rights: ${list}${scripts.length > 6 ? `; and ${scripts.length - 6} more` : ""}. Run without scripts adds --ignore-scripts, which is checked again before it runs.`,
    risk: 78,
    scripts,
  }
}

/** The same command with --ignore-scripts after each install in it, for "Run without scripts". */
export function withoutScripts(command: string): string {
  return command
    .split(/(&&|\|\||[;|\n])/)
    .map((part, i) => {
      // The separators, kept as they were.
      if (i % 2 === 1) return part
      const words = [...part.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "")
      if (!installOf(words)) return part
      // After the manager and its install word (yarn on its own: after yarn).
      const head = /^(\s*\S+)(\s+(?:install|i|add|ci|isntall|in)\b)?/i.exec(part)![0]
      return `${head} --ignore-scripts${part.slice(head.length)}`
    })
    .join("")
}
