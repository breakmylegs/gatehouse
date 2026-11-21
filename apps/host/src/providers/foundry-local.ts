/**
 * C-067: Microsoft Foundry Local as a model runtime on this computer (ADR 0011). It speaks the OpenAI chat completions
 * API, so it is an openai-compatible runtime with the profile "foundry-local" (a new kind would make an older version
 * refuse the settings file; this way an older one keeps the profile and treats it as any OpenAI-compatible server).
 * Codehouse never installs or starts it; IT does.
 * - Its port changes each time it starts, so Codehouse finds it: `foundry server status` (older releases: `foundry
 *   service status`) names its address, and only an address on this computer that answers /openai/status is taken.
 * - Its models are the ones it has downloaded (/openai/models), and a model's licence comes from its catalogue
 *   (/foundry/list), shown before first use like Ollama's.
 * - IT's signed list of models applies as for any runtime (checkRuntime). No credential is involved.
 */
import { execFile } from "node:child_process"
import { findOnPath } from "../welcome.js"

export const FOUNDRY_PROFILE = "foundry-local"
/** The port in Microsoft's examples, tried when the command is not on the PATH. */
export const FOUNDRY_DEFAULT_URL = "http://127.0.0.1:5272"

const ADDRESS = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}/g
const base = (url: string) => url.replace(/\/+$/, "")

/** The addresses on this computer that the command's output names, in order, each once. Others are ignored. */
export function addressesIn(output: string): string[] {
  return [...new Set(output.match(ADDRESS) ?? [])]
}

export type RunCommand = (file: string, args: string[]) => Promise<string>

const runCommand: RunCommand = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, windowsHide: true, maxBuffer: 256 * 1024 }, (_err, stdout, stderr) =>
      resolve(`${stdout ?? ""}\n${stderr ?? ""}`),
    )
  })

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`${res.status}`)
  return (await res.json()) as unknown
}

/** The names of the models Foundry Local has downloaded, or undefined when it does not answer as Foundry Local does. */
export async function foundryModels(url: string, fetchFn: typeof fetch = fetch): Promise<string[] | undefined> {
  try {
    const v = await getJson(fetchFn, `${base(url)}/openai/models`)
    return Array.isArray(v) ? v.filter((m): m is string => typeof m === "string") : undefined
  } catch {
    return undefined
  }
}

export interface FoundFoundry {
  url: string
  /** The models it has downloaded, for the list you allow. */
  models: string[]
  /** Where the command is, when it was on the PATH. */
  command?: string
}

/**
 * Finds Foundry Local on this computer: the address its command names, else the default port. Only a program file
 * (never a script) is run, with no shell; only an address on this computer is asked, never following a redirect.
 */
export async function findFoundry(
  env: NodeJS.ProcessEnv = process.env,
  run: RunCommand = runCommand,
  fetchFn: typeof fetch = fetch,
  platform: NodeJS.Platform = process.platform,
  exists?: (p: string) => boolean,
): Promise<FoundFoundry | undefined> {
  const command = findOnPath("foundry", platform === "win32" ? { ...env, PATHEXT: ".EXE" } : env, platform, exists)
  const candidates: string[] = []
  if (command)
    for (const args of [
      ["server", "status"],
      ["service", "status"],
    ]) {
      const found = addressesIn(await run(command, args))
      candidates.push(...found)
      if (found.length) break
    }
  candidates.push(FOUNDRY_DEFAULT_URL)
  for (const url of [...new Set(candidates)]) {
    try {
      const status = (await getJson(fetchFn, `${url}/openai/status`)) as { Endpoints?: unknown }
      if (!status || typeof status !== "object" || !Array.isArray(status.Endpoints)) continue
    } catch {
      continue
    }
    const models = await foundryModels(url, fetchFn)
    if (models) return { url, models, ...(command ? { command } : {}) }
  }
  return undefined
}

/** A model's licence from Foundry Local's catalogue, by its name or alias: the licence and its description. */
export async function foundryLicence(url: string, model: string, fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const v = (await getJson(fetchFn, `${base(url)}/foundry/list`)) as { models?: unknown } | unknown[]
    const list = Array.isArray(v) ? v : Array.isArray((v as { models?: unknown }).models) ? ((v as { models: unknown[] }).models) : []
    const entry = list
      .map((m) => m as { name?: unknown; alias?: unknown; license?: unknown; licenseDescription?: unknown })
      .find((m) => m.name === model || m.alias === model)
    if (!entry) return undefined
    const text = [entry.license, entry.licenseDescription]
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .join("\n\n")
    return text ? text.slice(0, 50_000) : undefined
  } catch {
    return undefined
  }
}
