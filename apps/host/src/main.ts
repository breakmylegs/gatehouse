/**
 * Starts Gatehouse: the Approver, the policy, the audit log and the Host server for the desktop UI.
 * Prints one JSON line with the address to open. The address carries the per-launch token in its fragment,
 * which a browser never sends to any server, and the UI keeps it only for this launch.
 */
import { AwakeWatch } from "./awake.js"
import path from "node:path"
import { createInterface } from "node:readline"
import { attentionDetail } from "./notify-mac.js"
import { generateToken } from "./approver-process.js"
import { gatehouseDataDir } from "@gatehouse/shared/node"
import { createHost, REPO_ROOT } from "./bootstrap.js"
import { fileLog } from "./host-log.js"
import { HostServer } from "./server.js"

const env = process.env
// E-098: started as the rehearsal of an upgrade: nothing is started, the steps are checked, and the process ends.
if (env.GATEHOUSE_REHEARSE === "1") {
  const { rehearseAndReport } = await import("./rehearse-run.js")
  process.exit(await rehearseAndReport(env))
}
const logFile = fileLog(path.join(gatehouseDataDir(env), "host.log"))
const log = (line: string) => {
  process.stderr.write(`[host] ${line}\n`)
  logFile.write(line)
}

// The start-up picture shows these steps as they happen. This first one means the Host's own code has loaded.
const progress = (text: string) =>
  process.stdout.write(JSON.stringify({ event: "progress", text }) + "\n")
progress("Setting up")
const host = createHost({
  log,
  onHealthChanged: () => server.announceHealth(),
  onProgress: progress,
  keepOpenSessions: true,
  limitResources: true,
})
logFile.setTerms(() => host.config.redactTerms)
const token = generateToken()
// The window app shows a Windows notification from this line, so it works even while the page is hidden in the
// tray or minimised. The line carries no detail: what the request is stays inside the app. Mac fork (owner, 25 Nov):
// on a Mac it also carries the request's id, kind and risk band (notify-mac.ts), for the notification's Deny and
// Allow once, and "settled" takes a decided request's notification away.
const mac = process.platform === "darwin"
host.app.broker.on("created", (view) => {
  process.stdout.write(JSON.stringify({ event: "attention", ...(mac ? attentionDetail(view) : {}) }) + "\n")
})
if (mac) host.app.broker.on("resolved", ({ id }) => process.stdout.write(JSON.stringify({ event: "settled", id }) + "\n"))
// Keep the computer awake while a session works (owner, 4 Nov): the window app asks Windows not to sleep while this
// says on. Checked again each minute, so turning the setting off lets go without waiting for a session to change.
// Mac fork (owner, 25 Nov): not while the battery is low, so an unattended run does not drain it (power.ts).
const awake = new AwakeWatch(
  () => host.config.keepAwake !== false && !host.power.low,
  (on) => process.stdout.write(JSON.stringify({ event: "awake", on }) + "\n"),
)
host.app.manager.on("session", (info) => awake.note(info))
setInterval(() => awake.check(), 60_000).unref()
// Restart now, after a setting that needs it. Only the window app can do it; the console launcher cannot.
if (env.GATEHOUSE_CAN_RESTART === "1")
  host.app.restart = () => process.stdout.write(JSON.stringify({ event: "restart" }) + "\n")
// Switching versions: the window app starts Codehouse-Update.exe with the plan, then closes Codehouse.
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
  // Mac fork (owner, 25 Nov): Codehouse.app writes the screen locking, sleep, wake and power changes on this input,
  // one JSON line each (presence-mac.ts). After a power change, keep-awake is looked at again too.
  const presence = host.presence
  if (presence)
    createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
      void presence
        .take(line)
        .then((s) => (s === "power" || s === "wake" ? awake.check() : undefined))
        .catch((e: Error) => log(`presence: ${e.message}`))
    })
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
  // E-047: workflows that were running go on from their last completed step.
  const resumed = server.resumeWorkflows()
  if (resumed) log(`workflows: ${resumed} resumed after the restart`)
  // O41: Neighbourhood Watch's commands join the server as clients, recorded with the channel cnw.
  void host.cnw.start((socket, via) => server.attachRemote(socket as never, via)).catch((e: Error) => log(`neighbourhood watch did not start: ${e.message}`))
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
  // Tells Codehouse-Update.exe, if it is waiting, that this version started.
  host.updates.markStarted(process.pid)
} catch (e) {
  log(`failed to start: ${(e as Error).message}`)
  await stop(1)
}
