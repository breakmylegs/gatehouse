import fs from "node:fs"
import path from "node:path"
import { createCnw } from "./server.js"
import { effective, type ServerSettings } from "./server-settings.js"
import { publicUrlOf } from "./tls.js"

/**
 * CNW in its container, listening on 8080. Its address comes from the Server page (server.json in the data folder)
 * when saved there, else from the environment (docker compose sets it from .env):
 *   CNW_DATA           the data folder (a volume), default /data
 *   CNW_HOST           the name or address people browse to; with CNW_PORT, it makes the public address
 *   CNW_PUBLIC_URL     the address people browse to, when it is not https://CNW_HOST[:CNW_PORT] (your own proxy)
 *   CNW_TRUSTED_PROXY  the proxy whose X-Forwarded-For is believed (bundled caddy, or your own); a comma list is
 *                      allowed. Unset: X-Forwarded-For is ignored.
 */
const dataDir = process.env.CNW_DATA ?? "/data"

function saved(): ServerSettings {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dataDir, "server.json"), "utf8")) as unknown
    return v && typeof v === "object" ? (v as ServerSettings) : {}
  } catch {
    return {}
  }
}

function publicUrl(): string {
  if (process.env.CNW_PUBLIC_URL) return process.env.CNW_PUBLIC_URL
  const e = effective(process.env, saved())
  // Behind your own proxy, CNW_PORT is the port CNW listens on, not the one people browse to.
  if (e.host) return publicUrlOf(e.host, process.env.CNW_MODE === "own-proxy" ? undefined : e.port)
  process.stderr.write("[cnw] Set CNW_HOST in .env to the name or address people browse to.\n")
  process.exit(1)
}
const { app } = await createCnw({
  dataDir,
  publicUrl: publicUrl(),
  ...(process.env.CNW_TRUSTED_PROXY ? { trustedProxy: process.env.CNW_TRUSTED_PROXY } : {}),
})
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) })
process.stdout.write(`[cnw] listening on ${process.env.PORT ?? 8080}\n`)
