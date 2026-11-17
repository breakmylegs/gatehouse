import { createCnw } from "./server.js"
import { publicUrlOf } from "./tls.js"

/**
 * CNW in its container: settings from the environment (docker compose sets them from .env), listening on 8080.
 *   CNW_DATA           the data folder (a volume), default /data
 *   CNW_HOST           the name or address people browse to; with CNW_PORT, it makes the public address
 *   CNW_PUBLIC_URL     the address people browse to, when it is not https://CNW_HOST[:CNW_PORT] (your own proxy)
 *   CNW_TRUSTED_PROXY  the proxy whose X-Forwarded-For is believed (bundled caddy, or your own); a comma list is
 *                      allowed. Unset: X-Forwarded-For is ignored.
 */
function publicUrl(): string {
  if (process.env.CNW_PUBLIC_URL) return process.env.CNW_PUBLIC_URL
  // Behind your own proxy, CNW_PORT is the port CNW listens on, not the one people browse to.
  if (process.env.CNW_HOST) return publicUrlOf(process.env.CNW_HOST, process.env.CNW_MODE === "own-proxy" ? undefined : process.env.CNW_PORT)
  process.stderr.write("[cnw] Set CNW_HOST in .env to the name or address people browse to.\n")
  process.exit(1)
}
const { app } = await createCnw({
  dataDir: process.env.CNW_DATA ?? "/data",
  publicUrl: publicUrl(),
  ...(process.env.CNW_TRUSTED_PROXY ? { trustedProxy: process.env.CNW_TRUSTED_PROXY } : {}),
})
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) })
process.stdout.write(`[cnw] listening on ${process.env.PORT ?? 8080}\n`)
