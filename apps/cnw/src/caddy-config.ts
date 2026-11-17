import fs from "node:fs"
import path from "node:path"
import { caddyfile, hostKind, tlsMode } from "./tls.js"

/**
 * The cnw-config service: runs once before caddy starts, writes caddy's configuration from .env (CNW_HOST, CNW_TLS,
 * CNW_PORT) into the caddy-config volume, and stops. A setting that cannot be used stops the stack with a plain
 * reason in `docker compose logs cnw-config`.
 */
const out = process.env.CNW_CADDY_OUT ?? "/caddy-config/Caddyfile"
try {
  const host = process.env.CNW_HOST ?? ""
  const text = caddyfile({ host, tls: process.env.CNW_TLS, port: process.env.CNW_PORT })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const tmp = `${out}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, out)
  process.stdout.write(`[cnw-config] ${host}: ${hostKind(host) === "ip" ? "an IP address" : hostKind(host) === "local" ? "a home-network name" : "a public name"}, certificate from ${tlsMode(host, process.env.CNW_TLS) === "internal" ? "caddy's own authority" : "Let's Encrypt"}\n`)
} catch (e) {
  process.stderr.write(`[cnw-config] ${(e as Error).message}\n`)
  process.exit(1)
}
