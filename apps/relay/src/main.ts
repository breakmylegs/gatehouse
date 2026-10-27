/**
 * Starts the Relay. Deployment settings come from the container environment (this is the server, not the
 * laptop app): RELAY_PUBLIC_URL is required because the passkey is bound to that address.
 */
import path from "node:path"
import { Store } from "./db.js"
import { WebPushSender } from "./push.js"
import { buildRelay } from "./server.js"

const env = process.env
const publicUrl = env.RELAY_PUBLIC_URL
if (
  !publicUrl ||
  (!/^https:\/\//.test(publicUrl) && !/^http:\/\/localhost(:\d+)?$/.test(publicUrl))
) {
  process.stderr.write(
    "RELAY_PUBLIC_URL must be the https address the phone uses, for example https://gatehouse.example.com\n",
  )
  process.exit(1)
}
const dataDir = env.RELAY_DATA_DIR ?? "/data"
const store = new Store(dataDir)
const enrolFile = path.join(dataDir, "enrol-token.txt")
const relay = await buildRelay({
  publicUrl,
  store,
  push: new WebPushSender(store, publicUrl),
  ...(env.RELAY_PHONE_DIST ? { phoneDist: env.RELAY_PHONE_DIST } : {}),
  enrolFile,
  log: (l) => process.stdout.write(`[relay] ${l}\n`),
})
const port = Number(env.RELAY_PORT ?? 8080)
await relay.app.listen({ host: env.RELAY_HOST ?? "0.0.0.0", port })
process.stdout.write(`[relay] listening on ${port}. One-time enrolment token is in ${enrolFile}\n`)
const stop = () => void relay.close().finally(() => process.exit(0))
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
process.on("unhandledRejection", (r) => {
  process.stderr.write(`[relay] unhandled rejection: ${String(r)}\n`)
  stop()
})
