/**
 * E-036, generated client drift (Expansion E3). Where a project generates its API client with orval, openapi-generator
 * (openapitools.json), NSwag (.nswag) or Kiota (kiota-lock.json), the client is generated again with the project's own
 * tool into a scratch folder and compared with the committed client: files added, gone or changed mean the committed
 * client no longer matches its spec.
 *
 * The scratch folder is inside the project's .codehouse folder, so the tool resolves from the project's own
 * node_modules by walking up, with no link to clean up; only the config and the spec are copied in. The tool runs as a
 * Codehouse action (section 6: judged by the rules as the same command from the session, no credentials, at the
 * session's level), and the scratch folder is deleted afterwards whatever happened.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export type ClientTool = "orval" | "openapi-generator" | "nswag" | "kiota"

export interface Generator {
  tool: ClientTool
  /** The config, relative to the project. */
  config: string
  /** The spec it reads, relative to the project, when the config says. */
  spec?: string
  /** Where the committed client is, relative to the project. */
  output: string
  /** The command that generates it again, run in the scratch folder. */
  command: string
}

const posix = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "")
const near = (config: string, rel: string) => posix(path.posix.normalize(path.posix.join(path.posix.dirname(posix(config)), posix(rel))))
/** A path a config names, resolved from the config's folder; undefined when it is a URL, absolute or outside the project. */
const inside = (config: string, rel: string | undefined): string | undefined => {
  if (!rel || path.isAbsolute(rel) || /^[a-z]+:/i.test(rel)) return undefined
  const p = near(config, rel.replace(/^#\{cwd\}\//, ""))
  return p.startsWith("..") ? undefined : p
}
const specOf = (config: string, rel: string | undefined) => {
  const p = inside(config, rel)
  return p ? { spec: p } : {}
}

/** The client generators a project has, from its file list. */
export function findGenerators(paths: string[], read: (p: string) => string | undefined): Generator[] {
  const out: Generator[] = []
  for (const p of paths.map(posix)) {
    const base = path.posix.basename(p)
    const text = read(p) ?? ""
    if (/^orval\.config\.(ts|js|mjs|cjs)$/.test(base)) {
      const target = inside(p, /output\s*:\s*\{[^}]*?target\s*:\s*['"`]([^'"`]+)['"`]/s.exec(text)?.[1])
      const input = /input\s*:\s*(?:\{[^}]*?target\s*:\s*)?['"`]([^'"`]+)['"`]/s.exec(text)?.[1]
      if (target) out.push({ tool: "orval", config: p, ...specOf(p, input), output: path.posix.dirname(target), command: `npx --no-install orval --config ${base}` })
    } else if (base === "openapitools.json") {
      try {
        const gens = (JSON.parse(text) as { "generator-cli"?: { generators?: Record<string, { output?: string; inputSpec?: string }> } })["generator-cli"]?.generators ?? {}
        for (const g of Object.values(gens)) {
          const output = inside(p, g.output)
          if (output) out.push({ tool: "openapi-generator", config: p, ...specOf(p, g.inputSpec), output, command: "npx --no-install openapi-generator-cli generate" })
        }
      } catch {
        // Not JSON: not a config.
      }
    } else if (/\.nswag$/i.test(base)) {
      try {
        const j = JSON.parse(text.replace(/^\uFEFF/, "")) as { documentGenerator?: { fromDocument?: { url?: string } }; codeGenerators?: Record<string, { output?: string }> }
        for (const g of Object.values(j.codeGenerators ?? {})) {
          const output = inside(p, g.output)
          if (output) out.push({ tool: "nswag", config: p, ...specOf(p, j.documentGenerator?.fromDocument?.url), output: path.posix.dirname(output), command: `dotnet nswag run ${base}` })
        }
      } catch {
        // Not JSON: not a config.
      }
    } else if (base === "kiota-lock.json") {
      try {
        const j = JSON.parse(text) as { descriptionLocation?: string }
        const dir = path.posix.dirname(p)
        out.push({ tool: "kiota", config: p, ...specOf(p, j.descriptionLocation), output: dir, command: `kiota update --output ${JSON.stringify(dir)}` })
      } catch {
        // Not JSON: not a lock file.
      }
    }
  }
  return out
}

/** Every file under a folder, by its path relative to it. */
function filesUnder(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && out.size < 5000) out.set(posix(path.relative(dir, p)), fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n"))
    }
  }
  walk(dir)
  return out
}

export interface Drift {
  added: string[]
  gone: string[]
  changed: string[]
}

/** How a generated folder differs from the committed one. */
export function diffFolders(committed: string, generated: string): Drift {
  const a = filesUnder(committed)
  const b = filesUnder(generated)
  return {
    added: [...b.keys()].filter((k) => !a.has(k)).sort(),
    gone: [...a.keys()].filter((k) => !b.has(k)).sort(),
    changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).sort(),
  }
}

export type RunAction = (command: string, cwd: string) => Promise<{ ran: boolean; exitCode: number | null; output: string; refused?: string }>

export interface DriftResult {
  tool: ClientTool
  output: string
  drift?: Drift
  /** Why it could not be checked. */
  notChecked?: string
}

/** Generates the client again in a scratch folder with the project's tool, and compares it with the committed one. */
export async function checkDrift(root: string, g: Generator, run: RunAction): Promise<DriftResult> {
  const scratch = path.join(root, ".codehouse", `client-drift-${crypto.randomBytes(4).toString("hex")}`)
  try {
    for (const rel of [g.config, g.spec].filter((x): x is string => !!x)) {
      const from = path.join(root, rel)
      if (!fs.existsSync(from)) continue
      fs.mkdirSync(path.dirname(path.join(scratch, rel)), { recursive: true })
      fs.copyFileSync(from, path.join(scratch, rel))
    }
    const r = await run(g.command, path.join(scratch, path.posix.dirname(g.config)))
    if (!r.ran) return { tool: g.tool, output: g.output, notChecked: `the generator was not run: ${r.refused ?? "refused"}` }
    if (r.exitCode !== 0) return { tool: g.tool, output: g.output, notChecked: `the generator failed (exit ${r.exitCode}): ${r.output.trim().split("\n").slice(-2).join(" ").slice(0, 200)}` }
    return { tool: g.tool, output: g.output, drift: diffFolders(path.join(root, g.output), path.join(scratch, g.output)) }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

export const hasDrift = (d: Drift | undefined) => !!d && d.added.length + d.gone.length + d.changed.length > 0
