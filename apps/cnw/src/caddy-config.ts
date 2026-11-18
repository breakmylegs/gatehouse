import fs from "node:fs"
import path from "node:path"
import { effective, type ServerSettings } from "./server-settings.js"
import { caddyfile, hostKind, tlsMode } from "./tls.js"

/**
 * The cnw-config service: runs before caddy starts, and again whenever a change on CNW's Server page is applied. It
 * writes caddy's configuration into the caddy-config volume from the settings saved on that page (server.json in the
 * cnw-data volume), each falling back to .env (CNW_HOST, CNW_TLS, CNW_PORT), and stops. A setting that cannot be used
 * stops the stack with a plain reason in `docker compose logs cnw-config`.
 *
 * It also copies caddy's root certificate (the public part only, never its key) next to the configuration, so the
 * Server page can offer it to download and trust. On the very first start caddy has not made it yet; it is there from
 * the next start or the next applied change.
 */
const out = process.env.CNW_CADDY_OUT ?? "/caddy-config/Caddyfile"
const settingsFile = process.env.CNW_SETTINGS_FILE ?? "/data/server.json"
const rootCrt = process.env.CNW_CADDY_ROOT ?? "/caddy-data/caddy/pki/authorities/local/root.crt"

function saved(): ServerSettings {
  try {
    const v = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as unknown
    return v && typeof v === "object" ? (v as ServerSettings) : {}
  } catch {
    return {}
  }
}

const atomic = (file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

try {
  const e = effective(process.env, saved())
  atomic(out, caddyfile({ host: e.host, tls: e.tls, port: e.port }))
  process.stdout.write(`[cnw-config] ${e.host}: ${hostKind(e.host) === "ip" ? "an IP address" : hostKind(e.host) === "local" ? "a home-network name" : "a public name"}, certificate from ${tlsMode(e.host, e.tls) === "internal" ? "caddy's own authority" : "Let's Encrypt"}\n`)
  try {
    const crt = fs.readFileSync(rootCrt)
    if (crt.includes("-----BEGIN CERTIFICATE-----") && !crt.includes("PRIVATE KEY")) atomic(path.join(path.dirname(out), "root.crt"), crt)
  } catch {
    // Not made yet (the first start), or Let's Encrypt only: nothing to offer.
  }
} catch (e) {
  process.stderr.write(`[cnw-config] ${(e as Error).message}\n`)
  process.exit(1)
}
