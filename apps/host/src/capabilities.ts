import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { compileGlobs } from "@gatehouse/policy"

/**
 * D-047 (frontier, Insight and evidence): the capability map. A project says which business capabilities its code
 * serves in .codehouse/capabilities.yml (next to D-041's architecture.yml), and a change's evidence pack (D-003) names
 * the capabilities its files touch, so a reviewer sees "this changes Billing and Customer sign-in" rather than a list
 * of paths.
 *
 *   capabilities:
 *     - name: Billing
 *       owner: Finance            (optional)
 *       paths: [src/billing/**, src/invoices/**]
 */
export interface Capability {
  name: string
  owner?: string
  match: (file: string) => boolean
}

export const CAPABILITIES_FILE = path.join(".codehouse", "capabilities.yml")

/** The project's map, or a plain reason it cannot be read; undefined when it has none. */
export function loadCapabilities(root: string): Capability[] | string | undefined {
  const file = path.join(root, CAPABILITIES_FILE)
  if (!fs.existsSync(file)) return undefined
  let doc: unknown
  try {
    doc = parseYaml(fs.readFileSync(file, "utf8"))
  } catch (e) {
    return `${CAPABILITIES_FILE} is not YAML: ${(e as Error).message.split("\n")[0]}`
  }
  const list = (doc as { capabilities?: unknown })?.capabilities
  if (!Array.isArray(list)) return `${CAPABILITIES_FILE} needs a capabilities list.`
  const out: Capability[] = []
  for (const c of list.slice(0, 200)) {
    const o = (c && typeof c === "object" ? c : {}) as { name?: unknown; owner?: unknown; paths?: unknown }
    const globs = Array.isArray(o.paths) ? o.paths.filter((p): p is string => typeof p === "string" && p.length > 0) : []
    if (typeof o.name !== "string" || !o.name.trim() || !globs.length) return `Each capability in ${CAPABILITIES_FILE} needs a name and its paths.`
    out.push({ name: o.name.trim().slice(0, 80), ...(typeof o.owner === "string" && o.owner.trim() ? { owner: o.owner.trim().slice(0, 80) } : {}), match: compileGlobs(globs.map((g) => g.replace(/\\/g, "/").toLowerCase())) })
  }
  return out
}

/** The capabilities a change touches, each with its changed files, in the map's order. */
export function affected(map: Capability[], files: string[]): Array<{ name: string; owner?: string; files: string[] }> {
  const norm = files.map((f) => f.replace(/\\/g, "/"))
  return map
    .map((c) => ({ name: c.name, ...(c.owner ? { owner: c.owner } : {}), files: norm.filter((f) => c.match(f.toLowerCase())) }))
    .filter((c) => c.files.length > 0)
}
