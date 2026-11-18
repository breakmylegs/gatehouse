import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { CNW_RELEASE_KEYS } from "./release-key.js"
import { checkSettings } from "./server-settings.js"

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
  /** What changed, in plain words (uplift phase 5). */
  notes?: string
}

/** Checks the manifest against its Ed25519 signature; returns it only when the signature holds. */
export function verifyManifest(json: string, sigB64: string, publicKeyPem: string): UpdateManifest | undefined {
  try {
    const ok = crypto.verify(null, Buffer.from(json), crypto.createPublicKey(publicKeyPem), Buffer.from(sigB64.trim(), "base64"))
    if (!ok) return undefined
    const m = JSON.parse(json) as Partial<UpdateManifest>
    if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+$/.test(m.version)) return undefined
    if (typeof m.commit !== "string" || !/^[0-9a-f]{40}$/.test(m.commit)) return undefined
    return { version: m.version, commit: m.commit, ...(typeof m.minFrom === "string" ? { minFrom: m.minFrom } : {}), ...(typeof m.notes === "string" ? { notes: m.notes.slice(0, 4000) } : {}) }
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

/**
 * Waits for CNW's own health check (its image's HEALTHCHECK), as scripts/update.sh does: up to 48 looks, five seconds
 * apart (four minutes). "healthy", or why not: "unhealthy", the container gone ("exited", "dead"), or "timed out".
 */
export async function waitHealthy(read: () => Promise<string>, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), looks = 48): Promise<string> {
  for (let i = 0; i < looks; i++) {
    const status = await read().catch(() => "unknown")
    if (status === "healthy" || status === "unhealthy" || status === "exited" || status === "dead") return status
    await wait(5000)
  }
  return "timed out"
}

/** The cnw container's health, as docker reports it. */
async function cnwHealth(composeDir: string): Promise<string> {
  const id = (await run("docker", ["compose", "ps", "-q", "cnw"], composeDir, 30_000)).trim()
  if (!id) return "starting"
  return (await run("docker", ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", id], composeDir, 30_000)).trim()
}

export async function updateNow(o: { repoDir: string; composeDir: string; keyPem: string; current: string; log: (l: string) => void; wait?: (ms: number) => Promise<void> }): Promise<string> {
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
  // Uplift phase 5: what runs now is kept to go back to: its image as codehouse-cnw:previous, its commit in .git.
  const before = (await git("rev-parse", "HEAD")).trim()
  await run("docker", ["image", "tag", "codehouse-cnw:latest", "codehouse-cnw:previous"], o.composeDir).catch((e: Error) => o.log(`the running image could not be kept to go back to: ${e.message}`))
  fs.writeFileSync(path.join(o.repoDir, ".git", "cnw-previous"), JSON.stringify({ commit: before, version: o.current, at: new Date().toISOString() }))
  await git("checkout", "--detach", m.commit)
  o.log(`building CNW ${m.version}`)
  // No -f: compose reads compose.yml and .env from the stack's folder, so a COMPOSE_FILE set there (your own proxy) is
  // kept. CNW_REPO_DIR (set for this service) is the build context, the clone just checked out.
  await run("docker", ["compose", "build", "cnw"], o.composeDir)
  await run("docker", ["compose", "up", "-d", "cnw"], o.composeDir, 5 * 60_000)
  // Uplift phase 6: the same check as scripts/update.sh. CNW must report healthy within four minutes, or the update
  // is undone: the kept image and commit go back, and the answer says so.
  const health = await waitHealthy(() => cnwHealth(o.composeDir), o.wait)
  if (health === "healthy") return `Updated to ${m.version}.`
  o.log(`CNW ${m.version} did not come up healthy (${health}); going back`)
  await rollback({ repoDir: o.repoDir, composeDir: o.composeDir, log: o.log })
  return `Rolled back: CNW ${m.version} did not come up healthy (${health}), so the version from before runs again.`
}

/** What Server, Updates shows: this version, the newest signed one with its notes, and the one to go back to. */
export async function updateInfo(o: { repoDir: string; keyPem: string; current: string }): Promise<{ current: string; latest?: string; notes?: string; newer: boolean; previous?: { version: string; at: string } }> {
  const previous = previousOf(o.repoDir)
  try {
    const base = `${REPO}/releases/download/cnw-latest`
    const [json, sig] = await Promise.all([fetchText(`${base}/cnw-update.json`), fetchText(`${base}/cnw-update.sig`)])
    const m = verifyManifest(json, sig, o.keyPem)
    if (!m) return { current: o.current, newer: false, ...(previous ? { previous } : {}) }
    return { current: o.current, latest: m.version, ...(m.notes ? { notes: m.notes } : {}), newer: newer(m.version, o.current), ...(previous ? { previous } : {}) }
  } catch {
    return { current: o.current, newer: false, ...(previous ? { previous } : {}) }
  }
}

/** The version kept to go back to, when an update made one. */
export function previousOf(repoDir: string): { version: string; at: string; commit: string } | undefined {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(repoDir, ".git", "cnw-previous"), "utf8")) as { version?: unknown; at?: unknown; commit?: unknown }
    return typeof p.commit === "string" && /^[0-9a-f]{40}$/.test(p.commit) ? { version: String(p.version ?? "?"), at: String(p.at ?? ""), commit: p.commit } : undefined
  } catch {
    return undefined
  }
}

/** What going back runs: the kept image becomes the running one, the clone goes back to its commit, cnw starts again. */
export function rollbackCommands(commit: string): string[][] {
  return [
    ["git", "-c", "safe.directory=REPO", "checkout", "--detach", commit],
    ["docker", "image", "tag", "codehouse-cnw:previous", "codehouse-cnw:latest"],
    ["docker", "compose", "up", "-d", "--force-recreate", "--no-deps", "cnw"],
  ]
}

export async function rollback(o: { repoDir: string; composeDir: string; log: (l: string) => void }): Promise<void> {
  const p = previousOf(o.repoDir)
  if (!p) return o.log("there is no previous version to go back to")
  try {
    for (const [cmd, ...args] of rollbackCommands(p.commit)) {
      const fixed = args.map((a) => (a === "safe.directory=REPO" ? `safe.directory=${o.repoDir}` : a))
      await run(cmd!, fixed, cmd === "git" ? o.repoDir : o.composeDir, 10 * 60_000)
    }
    fs.rmSync(path.join(o.repoDir, ".git", "cnw-previous"), { force: true })
    o.log(`went back to CNW ${p.version}`)
  } catch (e) {
    o.log(`going back did not work: ${(e as Error).message}`)
  }
}

/**
 * Uplift phase 2: what applying a change from CNW's Server page runs. cnw-config writes caddy's configuration again
 * from the saved settings, then caddy and cnw are recreated, with the port in the environment so Docker publishes the
 * one chosen. Behind your own proxy there is no caddy: only cnw is recreated.
 */
export function applyCommands(s: { host: string; tls: string; port: string }, ownProxy: boolean): { commands: string[][]; env: Record<string, string> } {
  const env = { CNW_HOST: s.host, CNW_TLS: s.tls, CNW_PORT: s.port }
  if (ownProxy) return { commands: [["compose", "up", "-d", "--force-recreate", "--no-deps", "cnw"]], env }
  return {
    commands: [
      ["compose", "run", "--rm", "--no-deps", "cnw-config"],
      ["compose", "up", "-d", "--force-recreate", "--no-deps", "caddy", "cnw"],
    ],
    env,
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  let text = ""
  for await (const chunk of req) {
    text += String(chunk)
    if (text.length > 10_000) throw new Error("too large")
  }
  return JSON.parse(text || "{}")
}

/**
 * The updater's HTTP service: POST /update runs one update at a time; POST /apply takes the Server page's settings,
 * checks them again, answers at once (cnw is recreated by it, which ends the request that asked) and then applies them;
 * GET /health answers 200 for the container's health check, touching neither Docker nor the clone. Anything else is 404.
 */
export function updaterServer(
  update: () => Promise<string>,
  apply?: (s: { host: string; tls: string; port: string }) => Promise<void>,
  extra: { info?: () => Promise<unknown>; rollback?: () => Promise<void> } = {},
): http.Server {
  let busy = false
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    if (req.method === "GET" && req.url === "/info" && extra.info) {
      try {
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(await extra.info()))
      } catch (e) {
        return res.writeHead(502).end((e as Error).message)
      }
    }
    if (req.method === "POST" && req.url === "/rollback" && extra.rollback) {
      if (busy) return res.writeHead(409).end("An update or a change is already running.")
      busy = true
      // Answered first: going back recreates cnw, which ends the request that asked.
      res.writeHead(202).end("Going back to the previous version: CNW starts again with it in a minute.")
      void extra.rollback().finally(() => (busy = false))
      return
    }
    if (req.method === "POST" && req.url === "/apply" && apply) {
      if (busy) return res.writeHead(409).end("An update or a change is already running.")
      let checked: ReturnType<typeof checkSettings>
      try {
        checked = checkSettings(await readBody(req))
      } catch {
        return res.writeHead(400).end("That is not a setting.")
      }
      if ("error" in checked) return res.writeHead(422).end(checked.error)
      busy = true
      res.writeHead(202).end("Applying: caddy and CNW start again with it, which takes a minute.")
      void apply(checked.settings).finally(() => (busy = false))
      return
    }
    if (req.method !== "POST" || req.url !== "/update") return res.writeHead(404).end()
    if (busy) return res.writeHead(409).end("An update is already running.")
    busy = true
    try {
      res.writeHead(200).end(await update())
    } catch (e) {
      res.writeHead(500).end((e as Error).message)
    } finally {
      busy = false
    }
  })
}

// Run as a service: one request at a time, from the private network only.
if (process.argv[1] && path.basename(process.argv[1]).startsWith("updater")) {
  // The release key is built in (release-key.ts); CNW_UPDATE_KEY may name a file with another, for a fork.
  const keyPem = process.env.CNW_UPDATE_KEY ? fs.readFileSync(process.env.CNW_UPDATE_KEY, "utf8") : CNW_RELEASE_KEYS[0]!
  const repoDir = process.env.CNW_REPO_DIR ?? "/repo"
  const composeDir = process.env.CNW_COMPOSE_DIR ?? "/stack"
  const log = (l: string) => process.stdout.write(`[updater] ${l}\n`)
  updaterServer(
    () => updateNow({ repoDir, composeDir, keyPem, current: builtVersion(repoDir), log }),
    async (s) => {
      // Behind your own proxy, COMPOSE_FILE in .env names compose.own-proxy.yml, and there is no caddy to recreate.
      const envFile = path.join(composeDir, ".env")
      const ownProxy = /own-proxy/.test(fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "")
      const plan = applyCommands(s, ownProxy)
      try {
        for (const args of plan.commands)
          await new Promise<void>((resolve, reject) =>
            execFile("docker", args, { cwd: composeDir, env: { ...process.env, ...plan.env }, timeout: 5 * 60_000 }, (e, _out, err) =>
              e ? reject(new Error(String(err || e.message).slice(-2000))) : resolve(),
            ),
          )
        log(`applied the Server page's settings for ${s.host}`)
      } catch (e) {
        log(`the Server page's settings could not be applied: ${(e as Error).message}`)
      }
    },
    {
      info: () => updateInfo({ repoDir, keyPem, current: builtVersion(repoDir) }),
      rollback: () => rollback({ repoDir, composeDir, log }),
    },
  ).listen(8090, "0.0.0.0")

}
