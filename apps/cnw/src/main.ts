import { createCnw } from "./server.js"

/**
 * CNW in its container: settings from the environment (docker compose sets them), listening on 8080 for caddy only.
 *   CNW_DATA           the data folder (a volume), default /data
 *   CNW_PUBLIC_URL     the address people browse to, such as https://cnw.home.arpa
 *   CNW_TRUSTED_PROXY  caddy's address on the compose network, whose X-Forwarded-For is believed
 */
const publicUrl = process.env.CNW_PUBLIC_URL
if (!publicUrl) {
  process.stderr.write("[cnw] Set CNW_PUBLIC_URL to the address people browse to.\n")
  process.exit(1)
}
const { app } = await createCnw({
  dataDir: process.env.CNW_DATA ?? "/data",
  publicUrl,
  ...(process.env.CNW_TRUSTED_PROXY ? { trustedProxy: process.env.CNW_TRUSTED_PROXY } : {}),
})
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) })
process.stdout.write(`[cnw] listening for caddy on ${process.env.PORT ?? 8080}\n`)
