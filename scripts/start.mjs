// Starts Gatehouse: the Host (which starts the Approver), and opens the interface in your browser. It does what
// scripts/start.ps1 does with Node alone, so it also runs on a Mac, where PowerShell is not usually installed.
//
//   node scripts/start.mjs [--no-browser] [--relay] [--check] [--timeout <seconds>]
//
// --check starts it, confirms the Host answers with its token and refuses without it, then stops (exit 0 or 1).
// Builds the interface first if it has not been built. Stop with Ctrl+C. Nothing here starts at logon.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const timeoutAt = argv.indexOf("--timeout")
const timeoutSeconds = timeoutAt >= 0 ? Number(argv[timeoutAt + 1]) || 120 : 120

const say = (text) => console.log(`[gatehouse] ${text}`)

const major = Number(process.versions.node.split(".")[0])
if (major < 22) {
  say(`Node ${major} is too old. Gatehouse needs Node 22 or newer.`)
  process.exit(1)
}
if (!fs.existsSync(path.join(root, "node_modules"))) {
  say("Dependencies are missing. Run: npm ci")
  process.exit(1)
}
if (!fs.existsSync(path.join(root, "apps", "web", "dist", "index.html"))) {
  say("Building the interface (first start only)...")
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const built = spawnSync(npm, ["run", "build", "-w", "@gatehouse/web"], {
    cwd: root,
    stdio: "ignore",
    shell: process.platform === "win32",
  })
  if (built.status !== 0) {
    say("The interface did not build. Run: npm run build -w @gatehouse/web")
    process.exit(1)
  }
}

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs")
const children = []

/** One child per part. Closing its input tells it to stop cleanly (GATEHOUSE_EXIT_ON_STDIN_CLOSE). */
function startChild(entry) {
  const child = spawn(process.execPath, [tsx, entry], {
    cwd: root,
    env: { ...process.env, GATEHOUSE_EXIT_ON_STDIN_CLOSE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  children.push(child)
  return child
}

let stopping
/**
 * Closes each child's input, then ends whatever is still running after a few seconds, and exits. Every caller waits
 * on the same stop, so nothing after it runs.
 */
function stopAll(code) {
  stopping ??= (async () => {
    const running = () => children.filter((c) => c.exitCode === null && c.signalCode === null)
    for (const c of children) c.stdin.end()
    const deadline = Date.now() + 4000
    while (Date.now() < deadline && running().length) await new Promise((r) => setTimeout(r, 100))
    for (const c of running()) c.kill("SIGKILL")
    process.exit(code)
  })()
  return stopping
}
process.on("SIGINT", () => void stopAll(0))
process.on("SIGTERM", () => void stopAll(0))

/** The interface in the default browser: open on a Mac, the URL handler on Windows, xdg-open elsewhere. */
function openBrowser(url) {
  const [file, args] =
    process.platform === "darwin"
      ? ["/usr/bin/open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]]
  spawn(file, args, { detached: true, stdio: "ignore" }).unref()
}

async function check(ready) {
  const base = `http://127.0.0.1:${ready.port}`
  const token = ready.url.split("#token=")[1]
  try {
    const withToken = await fetch(`${base}/api/state`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
    const state = withToken.ok ? await withToken.json() : undefined
    const without = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(15_000) })
    if (state?.type === "hello" && !without.ok) {
      say("Check passed: the Host answers with its token and refuses without it.")
      return 0
    }
  } catch (e) {
    say(`Check failed: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  say("Check failed.")
  return 1
}

const host = startChild("apps/host/src/main.ts")
host.stderr.pipe(process.stderr)
const lines = readline.createInterface({ input: host.stdout })

const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    say(`The Host did not become ready in ${timeoutSeconds} seconds.`)
    resolve(undefined)
  }, timeoutSeconds * 1000)
  const onLine = (line) => {
    try {
      const j = JSON.parse(line)
      if (j?.event === "ready") {
        clearTimeout(timer)
        lines.off("line", onLine)
        resolve(j)
        return
      }
    } catch {
      // Not one of the Host's JSON lines: shown as it is.
    }
    console.log(line)
  }
  lines.on("line", onLine)
  host.on("exit", () => {
    clearTimeout(timer)
    resolve(undefined)
  })
})
if (!ready) {
  say(
    "The Host stopped before it was ready, or did not get ready in time. The messages above say why.",
  )
  await stopAll(1)
}

say(`Ready on port ${ready.port}.`)
say(`Open: ${ready.url}`)
say("The part after #token= is private to this run. Do not share it.")
lines.on("line", (line) => console.log(line))

if (flag("--relay")) {
  say("Starting the Relay (see docs/relay-local.md for the first-run address)...")
  const relay = startChild("apps/relay/src/main.ts")
  relay.stdout.pipe(process.stdout)
  relay.stderr.pipe(process.stderr)
}

if (flag("--check")) await stopAll(await check(ready))

if (!flag("--no-browser")) openBrowser(ready.url)

say("Running. Press Ctrl+C to stop.")
host.on("exit", (code) => {
  say(`The Host stopped (exit code ${code}).`)
  void stopAll(code ?? 1)
})
