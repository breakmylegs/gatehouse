/**
 * Starts Gatehouse: the Approver, the policy, the audit log and the Host server for the desktop UI.
 * Prints one JSON line with the address to open. The address carries the per-launch token in its fragment,
 * which a browser never sends to any server, and the UI keeps it only for this launch.
 */
import path from "node:path"
import { generateToken } from "./approver-process.js"
import { createHost, REPO_ROOT } from "./bootstrap.js"
import { HostServer } from "./server.js"

const env = process.env
const log = (line: string) => process.stderr.write(`[host] ${line}\n`)

// The start-up picture shows these steps as they happen. This first one means the Host's own code has loaded.
const progress = (text: string) =>
  process.stdout.write(JSON.stringify({ event: "progress", text }) + "\n")
progress("Setting up")
const host = createHost({
  log,
  onHealthChanged: () => server.announceHealth(),
  onProgress: progress,
})
const token = generateToken()
// The window app shows a Windows notification from this line, so it works even while the page is hidden in the
// tray or minimised. The line carries no detail: what the request is stays inside the app.
host.app.broker.on("created", () => {
  process.stdout.write(JSON.stringify({ event: "attention" }) + "\n")
})
// Switching versions: the window app starts JCVC-Update.exe with the plan, then closes JCVC.
host.updates.on("apply", ({ updater, plan }) => {
  process.stdout.write(JSON.stringify({ event: "apply-update", updater, plan }) + "\n")
})
const server = new HostServer({
  app: host.app,
  token,
  port: Number(env.GATEHOUSE_HOST_PORT ?? 47820),
  staticDir: env.GATEHOUSE_UI_DIR ?? path.join(REPO_ROOT, "apps", "web", "dist"),
})

let stopping = false
async function stop(code: number): Promise<void> {
  if (stopping) return
  stopping = true
  log("stopping")
  await server.close().catch(() => undefined)
  await host.stop().catch(() => undefined)
  process.exit(code)
}
// scripts/start.ps1 asks for a clean stop by closing our input, which is the one signal that works the same everywhere.
if (env.GATEHOUSE_EXIT_ON_STDIN_CLOSE === "1") {
  process.stdin.on("end", () => void stop(0))
  process.stdin.resume()
}
process.on("SIGINT", () => void stop(0))
process.on("SIGTERM", () => void stop(0))
process.on("unhandledRejection", (reason) => {
  log(`unhandled rejection: ${String(reason)}`)
  void stop(1)
})
process.on("uncaughtException", (e) => {
  log(`uncaught exception: ${e.message}`)
  void stop(1)
})

try {
  await host.start()
  progress("Opening the window")
  const port = await server.start()
  // Refresh the sign-in state for the header in the background. A failure only leaves it unknown.
  void host.app.account
    .refresh()
    .then(() => server.announceHealth())
    .catch(() => undefined)
  process.stdout.write(
    JSON.stringify({
      event: "ready",
      port,
      url: `http://127.0.0.1:${port}/#token=${token}`,
      pid: process.pid,
    }) + "\n",
  )
  // Tells JCVC-Update.exe, if it is waiting, that this version started.
  host.updates.markStarted(process.pid)
} catch (e) {
  log(`failed to start: ${(e as Error).message}`)
  await stop(1)
}
