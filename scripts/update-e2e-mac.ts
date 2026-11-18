// Mac fork (18 Nov): the Mac in-app updater, end to end on this Mac, publishing nothing.
//
//   npm run package:mac, then: node node_modules/tsx/dist/cli.mjs scripts/update-e2e-mac.ts [--broken]
//
// Installs dist-app/Codehouse.app as version V in ~/Applications/.codehouse-e2e/, makes V+1 from it (its version
// changed and signed again, ad hoc, as package-mac.mjs signs), signs that as a Mac release with a throwaway key and
// serves it from a local stand-in for GitHub. It opens the installed copy with macOS's own open, with a data folder and
// port of its own (your Codehouse is not touched), and the copy's own Host finds the release, builds it and hands over
// to its own updater, which swaps the apps and opens V+1. Passes when V+1 says it started and V is kept to go back to.
// With --broken, V+1 cannot start its Host: passes when the updater puts V back.
//
// It shows a Codehouse window and menu bar icon for a minute or two. Everything it made is removed at the end.
import { execFileSync, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { UPDATE_REPO } from "../apps/host/src/update/source.js"
import { MAC_CHANNEL_TAG, macTag } from "../apps/host/src/update/release-mac.js"
import { appVersion } from "../apps/host/src/update/service-mac.js"
import { makeMacRelease } from "./release-mac.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const broken = process.argv.includes("--broken")
const say = (t: string) => console.log(`[update-e2e-mac] ${t}`)
const built = path.join(root, "dist-app", "Codehouse.app")
if (process.platform !== "darwin" || !fs.existsSync(built)) throw new Error("Run on a Mac after npm run package:mac.")

const place = path.join(os.homedir(), "Applications", ".codehouse-e2e")
const app = path.join(place, "Codehouse.app")
const work = fs.mkdtempSync(path.join(os.tmpdir(), "gh-update-e2e-mac-"))
const data = path.join(work, "data")
const updates = path.join(data, "updates")
let server: http.Server | undefined

const v = appVersion(built)
if (!v) throw new Error("The built app has no Mac version.")
const m = /^(.*\+mac\.)(\d+)(\.dev)?$/.exec(v)!
const next = `${m[1]}${Number(m[2]) + 1}`

/** Stops the test copy and its Host, asking first and then forcing what is left. */
function stopCopies(): void {
  for (const signal of ["-TERM", "-KILL"]) {
    const ps = spawnSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout
    for (const line of ps.split("\n")) {
      const pid = Number(line.trim().split(/\s+/)[0])
      if (pid && pid !== process.pid && line.includes(`${app}/Contents/`)) spawnSync("/bin/kill", [signal, String(pid)])
    }
    spawnSync("/bin/sleep", ["3"])
  }
}

async function main(): Promise<void> {
  say(`installing ${v} in ${place}`)
  fs.rmSync(place, { recursive: true, force: true })
  fs.mkdirSync(place, { recursive: true })
  execFileSync("/usr/bin/ditto", [built, app])

  say(`making ${next}${broken ? ", which cannot start its Host," : ""} and signing it as a Mac release`)
  const nextApp = path.join(work, "build", "Codehouse.app")
  execFileSync("/usr/bin/ditto", [built, nextApp])
  execFileSync("/usr/bin/plutil", ["-replace", "CodehouseVersion", "-string", next, path.join(nextApp, "Contents", "Info.plist")])
  if (broken) {
    const main = path.join(nextApp, "Contents", "Resources", "app", "apps", "host", "dist", "main.mjs")
    fs.writeFileSync(main, 'throw new Error("a version that cannot start (update-e2e-mac --broken)")\n')
  }
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", nextApp])
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString()
  const keyFile = path.join(work, "release-key.pub")
  fs.writeFileSync(keyFile, pub)
  const out = path.join(work, "release")
  await makeMacRelease({
    app: nextApp, out, version: next, arch: process.arch === "x64" ? "x64" : "arm64", notes: "- end to end",
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), keys: [pub],
  })

  // The stand-in for github.com: /<repo>/releases/download/<tag>/<file>, for the channel and the version's own tag.
  const tags = new Set([MAC_CHANNEL_TAG, macTag(next)])
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).split("/")
    const [, owner, repo, releases, download, tag, file] = p
    const ok = `${owner}/${repo}` === UPDATE_REPO && releases === "releases" && download === "download" && tags.has(tag!)
    const f = ok && file && !file.includes("/") ? path.join(out, file) : ""
    if (!f || !fs.existsSync(f)) return void res.writeHead(404).end()
    res.writeHead(200, { "content-length": fs.statSync(f).size })
    fs.createReadStream(f).pipe(res)
  })
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`

  fs.mkdirSync(updates, { recursive: true })
  fs.writeFileSync(path.join(data, "config.json"), JSON.stringify({ updates: { checkEveryMinutes: 30, downloadInBackground: true, skipped: [] } }))
  const env = {
    GATEHOUSE_DATA_DIR: data,
    GATEHOUSE_HOST_PORT: "47977",
    GATEHOUSE_UPDATE_BASE: base,
    GATEHOUSE_UPDATE_KEY_FILE: keyFile,
    GATEHOUSE_UPDATE_TEST_INSTALL: "1",
  }
  const envArgs = Object.entries(env).flatMap(([k, val]) => ["--env", `${k}=${val}`])
  // The updater opens the new version with this, so it starts with the same data folder and port.
  const opener = path.join(work, "open.sh")
  fs.writeFileSync(opener, `#!/bin/sh\nexec /usr/bin/open -n "$1" ${envArgs.map((a) => `'${a}'`).join(" ")} --env 'CODEHOUSE_UPDATE_OPEN=${opener}'\n`, { mode: 0o755 })

  say(`opening ${v}: its Host should find ${next}, build it, and switch`)
  execFileSync("/usr/bin/open", ["-n", app, ...envArgs, "--env", `CODEHOUSE_UPDATE_OPEN=${opener}`])
  const result = path.join(updates, "result.txt")
  const until = Date.now() + 8 * 60_000
  while (!fs.existsSync(result) && Date.now() < until) await new Promise((r) => setTimeout(r, 2000))
  if (!fs.existsSync(result)) {
    const log = path.join(updates, "update.log")
    throw new Error(`No result after 8 minutes.${fs.existsSync(log) ? `\n${fs.readFileSync(log, "utf8")}` : ""}`)
  }
  const text = fs.readFileSync(result, "utf8")
  say(`the updater says:\n${text.trim()}`)
  const now = appVersion(app)
  const kept = appVersion(path.join(updates, "mac-previous", "Codehouse.app"))
  if (broken) {
    if (!/^ok=false/m.test(text) || now !== v) throw new Error(`Expected ${v} back after ${next} did not start; ${app} is ${now}.`)
    say(`passed: ${next} did not start, so the updater put ${v} back`)
  } else {
    if (!/^ok=true/m.test(text) || now !== next || kept !== v)
      throw new Error(`Expected ${next} installed and ${v} kept; found ${now} installed and ${kept ?? "nothing"} kept.`)
    say(`passed: ${app} is now ${next}, and ${v} is kept to go back to`)
  }
}

main()
  .catch((e: Error) => {
    console.error(`[update-e2e-mac] FAILED: ${e.message}`)
    process.exitCode = 1
  })
  .finally(() => {
    stopCopies()
    server?.close()
    setTimeout(() => {
      fs.rmSync(place, { recursive: true, force: true })
      fs.rmSync(work, { recursive: true, force: true })
    }, 3000)
  })
