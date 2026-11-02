// End-to-end check that an install made before a rename updates in the app and moves into its own folder, on this
// computer, with nothing published (owner, 2 Nov: "We cant have a breaking change ever"):
//   1. copies an old install (E2E_FROM, for example one built from an old commit) into a temporary Programs folder
//   2. makes a signed release of the current package as 2.1.900 with a throwaway key, with the update routes from
//      release-channels.local.json (or channels.json beside the release key) and an installer built for the test
//      (its own AppId, so nothing of a real install is touched), served by a local stand-in for GitHub
//   3. starts the old install, which finds the release by its own route, downloads it and switches with Update
//   4. waits for the new version to start in the old folder, notice it arrived by an old route, run the installer
//      silently into the Codehouse folder beside it, and start from there
//
// Usage: npm run package, then: E2E_FROM=<old install folder> node node_modules/tsx/dist/cli.mjs scripts/update-route-e2e.ts
// It opens the Codehouse window for a moment, and closes everything it started at the end.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  makeRelease,
  newReleaseKey,
  stampInstall,
  type LegacyRoute,
} from "../apps/host/src/update/publish.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist-app", "Codehouse")
const say = (t: string) => console.log(`[route-e2e] ${t}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const versionIn = (dir: string) =>
  (JSON.parse(fs.readFileSync(path.join(dir, "release.json"), "utf8")) as { version: string })
    .version
const TEST_APPID = "3F0B9C2E-61A4-4E7D-8B25-0C9D7A1E5F42"
const UNINSTALL = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${TEST_APPID}}_is1`

if (!process.env.E2E_FROM) throw new Error("Set E2E_FROM to the folder of an old install.")
if (!fs.existsSync(path.join(dist, "release.json"))) throw new Error("Run npm run package first.")
const from = path.resolve(process.env.E2E_FROM)
const routesFile = [
  path.join(root, "release-channels.local.json"),
  path.join(process.env.USERPROFILE ?? "", ".codehouse-release", "channels.json"),
].find((f) => fs.existsSync(f))
if (!routesFile) throw new Error("No update routes file (see scripts/release.ts).")
const routes = (JSON.parse(fs.readFileSync(routesFile, "utf8")) as { legacy: LegacyRoute[] }).legacy
const console_ = fs.readdirSync(from).find((f) => /-Console\.exe$/i.test(f))
if (!console_) throw new Error(`${from} has no console launcher.`)
const original = fs.readFileSync(path.join(dist, "release.json"))
const v1 = versionIn(from)
const v2 = "2.1.900"
const t = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codeh-route-")))
const programs = path.join(t, "Programs")
const install = path.join(programs, path.basename(from))
const own = path.join(programs, "Codehouse")
const data = path.join(t, "data")
let failed = false
const check = (ok: boolean, what: string) => {
  say(`${ok ? "ok  " : "FAIL"} ${what}`)
  if (!ok) failed = true
}

try {
  say(`installing ${v1} into ${install}`)
  fs.cpSync(from, install, {
    recursive: true,
    filter: (src) => !fs.lstatSync(src).isSymbolicLink(),
  })

  // The installer carries the release's own version, as in a real release (package, then installer, then sign).
  await stampInstall(dist, { version: v2 })
  say("building an installer for the test, with its own AppId")
  const iss = fs
    .readFileSync(path.join(root, "packaging", "installer.iss"), "utf8")
    .replaceAll("6C1E5B0A-2F1D-4F3B-9D6E-6B7A0C2E41A7", TEST_APPID)
    .replace('#define AppName "Codehouse"', '#define AppName "CodehouseRouteTest"')
    .replace("Compression=lzma2", "Compression=none")
    .replace("SolidCompression=yes", "SolidCompression=no")
    .replace("OutputDir=..\\dist-app", `OutputDir=${t}`)
    .replaceAll("..\\dist-app", path.join(root, "dist-app"))
    .replaceAll("=brand\\", `=${path.join(root, "packaging", "brand")}\\`)
  if (iss.includes("6C1E5B0A")) throw new Error("The test installer still has the real AppId.")
  fs.writeFileSync(path.join(t, "route-test.iss"), iss)
  const iscc = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe")
  const c = spawnSync(iscc, ["/Q", `/DAppVersion=${v2}`, path.join(t, "route-test.iss")], {
    encoding: "utf8",
  })
  if (c.status !== 0) throw new Error(`The test installer did not build: ${c.stdout}${c.stderr}`)
  const setup = path.join(t, "Codehouse-Setup.exe")

  say(`making a signed release ${v2} with ${routes.length} update route(s)`)
  const key = newReleaseKey()
  fs.writeFileSync(path.join(t, "key.pub"), key.publicPem)
  const rel = path.join(t, "release")
  await makeRelease({
    dir: dist,
    out: rel,
    version: v2,
    notes: "- The update route check",
    privateKeyPem: key.privatePem,
    installer: setup,
    routes,
  })
  fs.copyFileSync(setup, path.join(rel, "Codehouse-Setup.exe"))
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
    // Streamed: the test installer is not compressed, and is hundreds of megabytes.
    res.writeHead(200, { "content-length": fs.statSync(file).size })
    fs.createReadStream(file).pipe(res)
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

  say(`starting the old install (${console_})`)
  const con = spawn(path.join(install, console_), ["--no-browser"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let out = ""
  con.stdout.on("data", (d) => (out += d))
  con.stderr.on("data", (d) => (out += d))
  let url: string | undefined
  for (const until = Date.now() + 240_000; !url && Date.now() < until;) {
    url = /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=\S+)/.exec(out)?.[1]
    if (!url) await sleep(500)
  }
  if (!url) throw new Error(`The old install did not start:\n${out}`)
  const origin = url.slice(0, url.indexOf("/#"))
  const token = url.slice(url.indexOf("#token=") + 7)
  const call = async (method: string, p: string, body?: unknown) =>
    (await (
      await fetch(origin + p, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    ).json()) as Record<string, unknown>

  say("the old install checks for updates by its own route")
  let st = await call("POST", "/api/update/check")
  check(
    st.available === true,
    `${v2} is offered to ${v1}${st.checkError ? `: ${st.checkError}` : ""}`,
  )
  check(
    seen.some((s) => routes.some((r) => s.endsWith(`/${r.manifest}`))),
    "it read the route's description, not this version's",
  )
  await call("POST", "/api/update/prepare", { version: v2 })
  for (const until = Date.now() + 600_000; Date.now() < until;) {
    st = await call("GET", "/api/update")
    if (st.phase === "ready" || st.phase === "failed") break
    await sleep(2000)
  }
  check(st.phase === "ready", `${v2} was downloaded and checked${st.error ? `: ${st.error}` : ""}`)

  say("choosing Update in the old install")
  await call("POST", "/api/update/apply", { version: v2 })
  const result = path.join(data, "updates", "result.txt")
  const seenResult = path.join(data, "updates", "result.seen.txt")
  // First the old install's own switch, then the move. The new version reads and renames the first result.
  const results: string[] = []
  for (const until = Date.now() + 900_000; Date.now() < until;) {
    if (fs.existsSync(seenResult)) {
      const text = fs.readFileSync(seenResult, "utf8")
      if (!results.includes(text)) results.push(text)
    }
    if (fs.existsSync(result)) {
      const text = fs.readFileSync(result, "utf8")
      if (!results.includes(text)) results.push(text)
    }
    if (results.some((r) => /mode=moveover/.test(r))) break
    await sleep(1000)
  }
  const flat = results.map((r) => r.replace(/\r?\n/g, " "))
  check(
    flat.some((r) => /ok=true/.test(r) && /mode=apply/.test(r)),
    `the old install switched to ${v2} in its own folder: ${flat.find((r) => /mode=apply/.test(r)) ?? "(no result)"}`,
  )
  check(
    flat.some((r) => /ok=true/.test(r) && /mode=moveover/.test(r)),
    `${v2} moved itself into the Codehouse folder and started there: ${flat.find((r) => /mode=moveover/.test(r)) ?? "(no result)"}`,
  )
  check(
    fs.existsSync(path.join(own, "Codehouse.exe")) && versionIn(own) === v2,
    `${own} holds ${v2}`,
  )
  check(!fs.existsSync(path.join(own, "move-over.json")), "the new folder has no note to move")
  const started = JSON.parse(
    fs.readFileSync(path.join(data, "updates", "started.json"), "utf8"),
  ) as { version: string }
  check(started.version === v2, `the running Host says it is ${v2}`)
  const running = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-Process Codehouse -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${own}*' } | Measure-Object | Select-Object -ExpandProperty Count`,
    ],
    { encoding: "utf8" },
  ).trim()
  check(Number(running) > 0, "Codehouse is running from its own folder")
  server.close()
} catch (e) {
  failed = true
  say(`FAIL ${(e as Error).message}`)
} finally {
  try {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-Process | Where-Object { $_.Path -like '${t}*' } | Stop-Process -Force`,
    ])
  } catch {
    // nothing running
  }
  fs.writeFileSync(path.join(dist, "release.json"), original)
  spawnSync("reg", ["delete", UNINSTALL, "/f"])
  const start = path.join(
    process.env.APPDATA ?? "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  )
  fs.rmSync(path.join(start, "CodehouseRouteTest"), { recursive: true, force: true })
  await sleep(2000)
  try {
    fs.rmSync(t, { recursive: true, force: true })
  } catch {
    say(`left ${t} behind (a file is still in use)`)
  }
}
say(failed ? "FAILED" : "passed")
process.exit(failed ? 1 : 0)
