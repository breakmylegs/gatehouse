// A deeper check of a packaged JCVC than JCVC.exe --check: starts the packaged copy with a throwaway data folder and
// makes it do the things a build could break without anyone noticing at start: the Approver and the PowerShell
// checker running, real decisions through the shell parser and the PowerShell parser, a secret sealed with DPAPI
// and removed, and the built Relay loading.
//
// Usage: node scripts/package-smoke.mjs [dist-app\JCVC]   (npm run package:check runs it)
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.resolve(process.argv[2] ?? path.join(root, "dist-app", "JCVC"))
const say = (t) => console.log(`[smoke] ${t}`)
const data = fs.mkdtempSync(path.join(os.tmpdir(), "jcvc-smoke-"))
const cwd = path.join(data, "project")
fs.mkdirSync(cwd)
const problems = []
const ok = (c, what) => {
  say(`${c ? "ok  " : "FAIL"} ${what}`)
  if (!c) problems.push(what)
}
const env = {
  ...process.env,
  GATEHOUSE_DATA_DIR: data,
  GATEHOUSE_AUDIT_DIR: path.join(data, "audit"),
  GATEHOUSE_CONFIG: path.join(data, "config.json"),
  GATEHOUSE_STATE: path.join(data, "state.json"),
  GATEHOUSE_HOST_PORT: "0",
}

const con = spawn(path.join(dist, "JCVC-Console.exe"), ["--no-browser"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
})
let out = ""
con.stdout.on("data", (d) => (out += d))
con.stderr.on("data", (d) => (out += d))
try {
  const until = Date.now() + 240_000
  let url
  while (!url && Date.now() < until) {
    url = /Open: (http:\/\/127\.0\.0\.1:\d+\/#token=\S+)/.exec(out)?.[1]
    if (!url) await new Promise((r) => setTimeout(r, 300))
  }
  if (!url) throw new Error(`the packaged copy did not start:\n${out.slice(-2000)}`)
  const origin = url.slice(0, url.indexOf("/#"))
  const token = url.slice(url.indexOf("#token=") + 7)
  const call = async (method, p, body) => {
    const r = await fetch(origin + p, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  }

  const ap = (await call("GET", "/api/approver")).json
  ok(ap.state === "up" && ap.supervised === true, `the Approver is running (${ap.state})`)
  ok(ap.pwsh?.running === true, "the PowerShell checker is running")
  ok(
    Array.isArray(ap.policy?.errors) && ap.policy.errors.length === 0,
    "the rules loaded without errors",
  )

  const decide = async (toolName, input) =>
    (await call("POST", "/api/policy/test", { toolName, input, cwd })).json
  let v = await decide("Bash", { command: "git status" })
  ok(v.outcome === "allow", `the shell parser allows git status (${v.outcome}, ${v.ruleId})`)
  v = await decide("Bash", { command: "git push --force" })
  ok(v.outcome === "deny", `the rules deny git push --force (${v.outcome}, ${v.ruleId})`)
  v = await decide("PowerShell", { command: "Get-ChildItem -Path ." })
  ok(
    !["pwsh-unavailable", "parse-error", "engine-error"].includes(v.ruleId),
    `the PowerShell parser reads a command (${v.outcome}, ${v.ruleId})`,
  )
  v = await decide("Read", { file_path: path.join(cwd, ".env") })
  ok(v.outcome === "deny", `the floor blocks a secrets file (${v.outcome}, ${v.ruleId})`)

  const put = await call("PUT", "/api/update/token", { token: "ghp_" + "a".repeat(36) })
  ok(
    put.status === 200 && put.json.tokenSet === true,
    `a secret is sealed with DPAPI (${put.status})`,
  )
  const del = await call("DELETE", "/api/update/token")
  ok(del.json.tokenSet === false, "and removed")

  const relay = spawnSync(
    path.join(dist, "runtime", "node.exe"),
    [path.join(dist, "app", "apps", "relay", "dist", "main.mjs")],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...env, GATEHOUSE_RELAY_DATA: path.join(data, "relay-test") },
    },
  )
  const said = `${relay.stdout}${relay.stderr}`
  ok(
    !/Cannot find (module|package)|ERR_MODULE_NOT_FOUND|SyntaxError|ReferenceError/.test(said),
    "the built Relay loads (it stops at its own settings check)",
  )
} catch (e) {
  problems.push(e.message)
  say(`FAIL ${e.message}`)
} finally {
  try {
    execFileSync("taskkill", ["/pid", String(con.pid), "/t", "/f"], { stdio: "ignore" })
  } catch {
    // already gone
  }
  await new Promise((r) => setTimeout(r, 1500))
  try {
    fs.rmSync(data, { recursive: true, force: true })
  } catch {
    // a file still in use; it is only a temporary folder
  }
}
say(problems.length ? `FAILED: ${problems.length}` : "passed")
process.exit(problems.length ? 1 : 0)
