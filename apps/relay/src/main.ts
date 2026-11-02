/**
 * Starts the Relay on this computer. It listens on 127.0.0.1 only: put an https tunnel (Tailscale, a
 * Cloudflare tunnel) in front of it so the phone can reach it. See docs/relay-local.md.
 */
import path from "node:path"
import { resolveRelayConfig } from "./config.js"
import { Store } from "./db.js"
import { WebPushSender } from "./push.js"
import { buildRelay } from "./server.js"

let cfg
try {
  cfg = resolveRelayConfig(process.argv.slice(2), process.env)
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`)
  process.exit(1)
}
const store = new Store(cfg.dataDir)
if (process.argv.includes("--rotate-vapid")) {
  // New push keys. Every phone must then turn notifications on again, because its subscription is tied to the old key.
  store.kvDelete("vapid")
  process.stdout.write(
    "[relay] push keys rotated. Open the phone app and choose Turn on notifications again.\n",
  )
}
const enrolFile = path.join(cfg.dataDir, "enrol-token.txt")
const relay = await buildRelay({
  publicUrl: cfg.publicUrl,
  store,
  push: new WebPushSender(store, cfg.publicUrl),
  ...(cfg.phoneDist ? { phoneDist: cfg.phoneDist } : {}),
  enrolFile,
  log: (l) => process.stdout.write(`[relay] ${l}\n`),
})
await relay.app.listen({ host: cfg.host, port: cfg.port })
process.stdout.write(
  `[relay] listening on ${cfg.host}:${cfg.port} for ${cfg.publicUrl}\n[relay] one-time enrolment token: ${enrolFile}\n`,
)
const stop = () => void relay.close().finally(() => process.exit(0))
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
process.on("unhandledRejection", (r) => {
  process.stderr.write(`[relay] unhandled rejection: ${String(r)}\n`)
  stop()
})
