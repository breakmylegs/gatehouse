/**
 * Starts the Approver. The Host spawns this with a random per-launch token in GATEHOUSE_APPROVER_TOKEN
 * and waits for the `listening` line on stdout. Configuration comes from the environment and, for
 * redaction terms, from config.json. Nothing here reads credentials.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PwshWorker } from "@gatehouse/policy"
import { auditDir, loadConfig } from "@gatehouse/shared/node"
import { assertUsableToken } from "./guard.js"
import { ApproverServer } from "./server.js"
import { createSdkJudge } from "./sdk-judge.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const env = process.env

const log = (line: string) => process.stderr.write(`[approver] ${line}\n`)

try {
  const token = assertUsableToken(env.GATEHOUSE_APPROVER_TOKEN)
  const config = loadConfig(env)
  const rulesPath =
    env.GATEHOUSE_RULES_PATH ?? config.rulesPath ?? path.resolve(here, "../../../policy/rules.yaml")
  const rulesDir = path.dirname(rulesPath)
  const server: ApproverServer = new ApproverServer({
    token,
    port: Number(env.GATEHOUSE_APPROVER_PORT ?? 47821),
    rules: {
      rulesPath,
      overlayDir: env.GATEHOUSE_OVERLAY_DIR ?? path.join(rulesDir, "projects"),
      localPath: env.GATEHOUSE_LOCAL_RULES ?? path.join(rulesDir, "rules.local.yaml"),
      // The same library and rules of yours as the Host, so the two always decide alike.
      libraryDir: env.GATEHOUSE_LIBRARY_DIR ?? path.join(rulesDir, "library"),
      userRulesPath: env.GATEHOUSE_USER_RULES ?? path.join(rulesDir, "rules.user.yaml"),
      ...(config.workspaceRoots ? { workspaceRootsOverride: config.workspaceRoots } : {}),
      ...(config.projectsFolder ? { extraWorkspaceRoots: [config.projectsFolder] } : {}),
    },
    auditDir: auditDir(env),
    redactTerms: config.redactTerms,
    promptCwd: env.GATEHOUSE_PROMPT_CWD ?? process.cwd(),
    pwsh: new PwshWorker(),
    // The judge is always wired in but does nothing unless the policy turns it on (it is off by default).
    judge: createSdkJudge({
      model: (): string | undefined => server.store.current?.rules.defaults?.judge?.model,
    }),
    watchRules: true,
    log,
  })
  const port = await server.start()
  process.stdout.write(JSON.stringify({ event: "listening", port, pid: process.pid }) + "\n")

  const stop = () => {
    server.close().finally(() => process.exit(0))
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  // On Windows a parent cannot send a catchable signal. The Host asks for a clean stop by closing our stdin,
  // and if the Host dies the same thing happens, so the Approver is never left running without its Host.
  if (env.GATEHOUSE_EXIT_ON_STDIN_CLOSE === "1") {
    process.stdin.resume()
    process.stdin.on("end", stop)
    process.stdin.on("close", stop)
  }
} catch (e) {
  log(`failed to start: ${(e as Error).message}`)
  process.exit(1)
}

// A rejected promise must end the process, so the Host restarts it, rather than leave it half alive.
process.on("unhandledRejection", (reason) => {
  log(`unhandled rejection: ${String(reason)}`)
  process.exit(1)
})
process.on("uncaughtException", (e) => {
  log(`uncaught exception: ${e.message}`)
  process.exit(1)
})
