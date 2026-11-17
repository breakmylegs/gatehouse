import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { CNW_RELEASE_KEYS } from "./release-key.js"

/**
 * The CNW updater (O41). It runs as its own service, the only one that can reach Docker (through a socket proxy), and
 * takes one request from cnw on the private network: "update". It then:
 *   1. fetches cnw-update.json and cnw-update.sig from the repository's latest CNW release,
 *   2. checks the signature with the release key built into the image (the same key Codehouse's updates use),
 *   3. fetches that exact commit into the repository clone the stack is built from, and checks it is the one signed,
 *   4. builds the new image and recreates cnw, keeping the previous image to go back to.
 * Anything unsigned, a different commit, or a failed build leaves CNW as it was. (Owner, 2 Nov: updates never break.)
 */
export interface UpdateManifest {
  /** The CNW version, such as 1.2.0. */
  version: string
  /** The full commit hash to build. */
  commit: string
  /** The oldest version that can update straight to this one. */
  minFrom?: string
}

/** Checks the manifest against its Ed25519 signature; returns it only when the signature holds. */
export function verifyManifest(json: string, sigB64: string, publicKeyPem: string): UpdateManifest | undefined {
  try {
    const ok = crypto.verify(null, Buffer.from(json), crypto.createPublicKey(publicKeyPem), Buffer.from(sigB64.trim(), "base64"))
    if (!ok) return undefined
    const m = JSON.parse(json) as Partial<UpdateManifest>
    if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+$/.test(m.version)) return undefined
    if (typeof m.commit !== "string" || !/^[0-9a-f]{40}$/.test(m.commit)) return undefined
    return { version: m.version, commit: m.commit, ...(typeof m.minFrom === "string" ? { minFrom: m.minFrom } : {}) }
  } catch {
    return undefined
  }
}

/**
 * The version the stack runs: the one in the checkout it was built from. Not CNW_VERSION, which compose.yml sets to
 * "latest" when unset, and which no version is newer than, so Update never updated. 0.0.0 when it cannot be read.
 */
export function builtVersion(repoDir: string): string {
  try {
    const v = (JSON.parse(fs.readFileSync(path.join(repoDir, "apps", "cnw", "package.json"), "utf8")) as { version?: unknown }).version
    return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : "0.0.0"
  } catch {
    return "0.0.0"
  }
}

/** Whether `a` is newer than `b`, both x.y.z. */
export const newer = (a: string, b: string): boolean => {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

const run = (cmd: string, args: string[], cwd: string, timeoutMs = 30 * 60_000): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) =>
      e ? reject(new Error(String(err || e.message).slice(-2000))) : resolve(String(out)),
    ),
  )

const REPO = "https://github.com/breakmylegs/gatehouse"

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { redirect: "follow" })
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return await r.text()
}

export async function updateNow(o: { repoDir: string; composeDir: string; keyPem: string; current: string; log: (l: string) => void }): Promise<string> {
  const base = `${REPO}/releases/download/cnw-latest`
  const [json, sig] = await Promise.all([fetchText(`${base}/cnw-update.json`), fetchText(`${base}/cnw-update.sig`)])
  const m = verifyManifest(json, sig, o.keyPem)
  if (!m) throw new Error("The update is not signed with the release key, so it was not used.")
  if (!newer(m.version, o.current)) return `Already up to date (${o.current}).`
  // The clone belongs to the machine's user, not this container's: git is told it is safe to use, this once.
  const git = (...args: string[]) => run("git", ["-c", `safe.directory=${o.repoDir}`, ...args], o.repoDir)
  await git("fetch", "--depth", "1", "origin", m.commit)
  const head = (await git("rev-parse", "FETCH_HEAD")).trim()
  if (head !== m.commit) throw new Error("The fetched commit is not the one signed, so it was not used.")
  await git("checkout", "--detach", m.commit)
  o.log(`building CNW ${m.version}`)
  // No -f: compose reads compose.yml and .env from the stack's folder, so a COMPOSE_FILE set there (your own proxy) is
  // kept. CNW_REPO_DIR (set for this service) is the build context, the clone just checked out.
  await run("docker", ["compose", "build", "cnw"], o.composeDir)
  await run("docker", ["compose", "up", "-d", "cnw"], o.composeDir, 5 * 60_000)
  return `Updated to ${m.version}.`
}

// Run as a service: one request at a time, from the private network only.
if (process.argv[1] && path.basename(process.argv[1]).startsWith("updater")) {
  // The release key is built in (release-key.ts); CNW_UPDATE_KEY may name a file with another, for a fork.
  const keyPem = process.env.CNW_UPDATE_KEY ? fs.readFileSync(process.env.CNW_UPDATE_KEY, "utf8") : CNW_RELEASE_KEYS[0]!
  let busy = false
  http
    .createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/update") return res.writeHead(404).end()
      if (busy) return res.writeHead(409).end("An update is already running.")
      busy = true
      try {
        const repoDir = process.env.CNW_REPO_DIR ?? "/repo"
        const msg = await updateNow({
          repoDir,
          composeDir: process.env.CNW_COMPOSE_DIR ?? "/stack",
          keyPem,
          current: builtVersion(repoDir),
          log: (l) => process.stdout.write(`[updater] ${l}\n`),
        })
        res.writeHead(200).end(msg)
      } catch (e) {
        res.writeHead(500).end((e as Error).message)
      } finally {
        busy = false
      }
    })
    .listen(8090, "0.0.0.0")
}
