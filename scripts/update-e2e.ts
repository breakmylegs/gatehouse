// End-to-end check of updating a real installed JCVC, on this computer, with nothing published:
//   1. copies the packaged dist-app\JCVC into a temporary Programs folder, without npm's workspace links (as the
//      installer does), so the first start has to make them
//   2. makes a signed release of the same package as version 1.0.900 with a throwaway key, served by a local stand-in
//      for GitHub
//   3. starts the installed copy, asks its Host to check, waits for the background download, and chooses Update
//   4. waits for JCVC-Update.exe to switch folders and for the new version to say it started, then checks the result
//
// Usage: npm run package, then: node node_modules/tsx/dist/cli.mjs scripts/update-e2e.ts
// It opens the JCVC window of the new version for a moment, and closes it at the end.
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { makeRelease, newReleaseKey } from "../apps/host/src/update/publish.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist-app", "JCVC")
const say = (t: string) => console.log(`[update-e2e] ${t}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const versionIn = (dir: string) =>
  (JSON.parse(fs.readFileSync(path.join(dir, "release.json"), "utf8")) as { version: string })
    .version

if (!fs.existsSync(path.join(dist, "release.json"))) throw new Error("Run npm run package first.")
const original = fs.readFileSync(path.join(dist, "release.json"))
const v1 = versionIn(dist)
const v2 = "1.0.900"
const t = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "jcvc-e2e-")))
const install = path.join(t, "Programs", "JCVC")
const data = path.join(t, "data")
let failed = false

const check = (ok: boolean, what: string) => {
  say(`${ok ? "ok  " : "FAIL"} ${what}`)
  if (!ok) failed = true
}

try {
  say(`installing ${v1} into ${install}`)
  fs.cpSync(dist, install, {
    recursive: true,
    filter: (src) => !fs.lstatSync(src).isSymbolicLink(),
  })

  say(`making a signed release ${v2} of the same package`)
  const key = newReleaseKey()
  fs.writeFileSync(path.join(t, "key.pub"), key.publicPem)
  const rel = path.join(t, "release")
  const made = await makeRelease({
    dir: dist,
    out: rel,
    version: v2,
    notes: "- The end-to-end check",
    privateKeyPem: key.privatePem,
  })
  fs.writeFileSync(path.join(dist, "release.json"), original)

  const seen: string[] = []
  const server = http.createServer((req, res) => {
    const url = req.url ?? ""
    seen.push(url)
    let m = /^\/breakmylegs\/gatehouse\/releases\/latest\/download\/([^/]+)$/.exec(url)
    if (m)
      return void res
        .writeHead(302, { location: `/breakmylegs/gatehouse/releases/download/v${v2}/${m[1]}` })
        .end()
    m = /^\/breakmylegs\/gatehouse\/releases\/download\/v([^/]+)\/([^/]+)$/.exec(url)
    const file = m && m[1] === v2 ? path.join(rel, m[2] as string) : undefined
    if (!file || !fs.existsSync(file)) return void res.writeHead(404).end()
    const body = fs.readFileSync(file)
    res.writeHead(200, { "content-length": body.length }).end(body)
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const env = {
    ...process.env,
    GATEHOUSE_DATA_DIR: data,
    GATEHOUSE_AUDIT_DIR: path.join(data, "audit"),
    GATEHOUSE_CONFIG: path.join(data, "config.json"),
    GATEHOUSE_STATE: path.join(data, "state.json"),
    GATEHOUSE_HOST_PORT: "0",
    GATEHOUSE_UPDATE_BASE: base,
    GATEHOUSE_UPDATE_KEY_FILE: path.join(t, "key.pub"),
  }
  say("starting the installed copy")
  const con = spawn(path.join(install, "JCVC-Console.exe"), ["--no-browser"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let out = ""
  con.stdout.on("data", (d) => (out += d))
  con.stderr.on("data", (d) => (out += d))
  const until = Date.now() + 240_000
  let url: string | undefined
  while (!url && Date.now() < until) {
    url = /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=\S+)/.exec(out)?.[1]
    if (!url) await sleep(500)
  }
  if (!url) throw new Error(`The installed copy did not start:\n${out}`)
  const origin = url.slice(0, url.indexOf("/#"))
  const token = url.slice(url.indexOf("#token=") + 7)
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(origin + p, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return (await r.json()) as Record<string, unknown>
  }
  const links = JSON.parse(
    fs.readFileSync(path.join(install, "app", "workspace-links.json"), "utf8"),
  ) as Array<{ link: string; target: string }>
  check(
    links.every(
      (l) =>
        fs.realpathSync(path.join(install, "app", l.link)).toLowerCase() ===
        path.join(install, "app", l.target).toLowerCase(),
    ),
    "the first start made the workspace links, pointing into the installed folder",
  )
  let st = await call("GET", "/api/update")
  check(
    st.current === v1 && st.kind === "release" && st.canInstall === true,
    `it knows it is ${v1} and can update itself`,
  )

  say("checking for updates")
  st = await call("POST", "/api/update/check")
  check(st.available === true, `${v2} is offered`)
  const ready = Date.now() + 600_000
  while (st.phase !== "ready" && st.phase !== "failed" && Date.now() < ready) {
    await sleep(2000)
    st = await call("GET", "/api/update")
  }
  check(
    st.phase === "ready",
    `${v2} was downloaded and checked in the background${st.error ? `: ${st.error}` : ""}`,
  )
  const zips = seen.filter((s) => s.endsWith(".zip"))
  check(
    zips.length === 1 && zips[0]!.endsWith("-app.zip"),
    `only the app part was downloaded (${zips.map((z) => path.basename(z)).join(", ")})`,
  )
  const appPart = made.manifest.parts.find((p) => p.name === "app")
  say(`downloaded ${Math.round((appPart?.size ?? 0) / 1024)} KB instead of the whole package`)

  say("choosing Update")
  await call("POST", "/api/update/apply", { version: v2 })
  const result = path.join(data, "updates", "result.txt")
  const done = Date.now() + 360_000
  while (!fs.existsSync(result) && Date.now() < done) await sleep(1000)
  const text = fs.existsSync(result) ? fs.readFileSync(result, "utf8") : "(no result)"
  check(
    /ok=true/.test(text),
    `JCVC-Update.exe switched and the new version started: ${text.replace(/\r?\n/g, " ")}`,
  )
  check(versionIn(install) === v2, `the install folder is now ${v2}`)
  check(versionIn(`${install}.previous`) === v1, `${v1} is kept beside it`)
  const started = JSON.parse(
    fs.readFileSync(path.join(data, "updates", "started.json"), "utf8"),
  ) as { version: string }
  check(started.version === v2, `the running Host says it is ${v2}`)
  check(
    links.every(
      (l) =>
        fs.realpathSync(path.join(install, "app", l.link)).toLowerCase() ===
        path.join(install, "app", l.target).toLowerCase(),
    ),
    "the new version's workspace links point into the install folder",
  )
  server.close()
} catch (e) {
  failed = true
  say(`FAIL ${(e as Error).message}`)
} finally {
  // Close every JCVC started from the temporary folder (its job object stops the Host with it).
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-Process JCVC,JCVC-Console,JCVC-Update -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${t}*' } | Stop-Process -Force`,
    ])
  } catch {
    // nothing running
  }
  fs.writeFileSync(path.join(dist, "release.json"), original)
  await sleep(2000)
  try {
    fs.rmSync(t, { recursive: true, force: true })
  } catch {
    say(`left ${t} behind (a file is still in use)`)
  }
}
say(failed ? "FAILED" : "passed")
process.exit(failed ? 1 : 0)
