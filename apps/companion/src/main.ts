/**
 * The Companion over stdio. The Host starts one per session with GATEHOUSE_SESSION_ID set, in the session's
 * working directory. It only ever talks to its own stdio, the Host's loopback endpoint and the local git repo.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { PolicyStore, redact } from "@gatehouse/policy"
import { loadConfig } from "@gatehouse/shared/node"
import { CompanionHandlers } from "./handlers.js"
import { HttpHostClient } from "./host-client.js"
import { createCompanionMcpServer } from "./server.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const env = process.env

const sessionId = env.GATEHOUSE_SESSION_ID
if (!sessionId) {
  process.stderr.write("[companion] GATEHOUSE_SESSION_ID is required\n")
  process.exit(1)
}
const config = loadConfig(env)
const rulesPath =
  env.GATEHOUSE_RULES_PATH ?? config.rulesPath ?? path.resolve(here, "../../../policy/rules.yaml")
const rulesDir = path.dirname(rulesPath)
const store = new PolicyStore({
  rulesPath,
  overlayDir: env.GATEHOUSE_OVERLAY_DIR ?? path.join(rulesDir, "projects"),
  localPath: env.GATEHOUSE_LOCAL_RULES ?? path.join(rulesDir, "rules.local.yaml"),
})

const handlers = new CompanionHandlers({
  sessionId,
  cwd: process.cwd(),
  host: new HttpHostClient(
    env.GATEHOUSE_HOST_URL ?? "http://127.0.0.1:47820",
    env.GATEHOUSE_HOST_TOKEN ?? "",
  ),
  policy: () => {
    store.load()
    return store.current
  },
  redact: (v) => redact(v, { terms: config.redactTerms }),
})

await createCompanionMcpServer(handlers).connect(new StdioServerTransport())
