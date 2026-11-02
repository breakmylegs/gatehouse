import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export interface RelayConfig {
  publicUrl: string
  dataDir: string
  phoneDist: string | undefined
  port: number
  host: string
}

const here = path.dirname(fileURLToPath(import.meta.url))

export function isAllowedPublicUrl(u: string): boolean {
  try {
    const p = new URL(u)
    return p.protocol === "https:" || (p.protocol === "http:" && p.hostname === "localhost")
  } catch {
    return false
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  if (i >= 0) return argv[i + 1]
  return argv.find((a) => a.startsWith(name + "="))?.slice(name.length + 1)
}

/**
 * Where everything is, with no setting that has to be in the environment. The public address is given once
 * (`--public-url`, or RELAY_PUBLIC_URL in a container) and then remembered in the data folder.
 */
export function resolveRelayConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
  home = os.homedir(),
): RelayConfig {
  const dataDir =
    argValue(argv, "--data-dir") ??
    env.RELAY_DATA_DIR ??
    (env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, "Gatehouse", "relay")
      : path.join(home, ".gatehouse-relay"))
  const saved = path.join(dataDir, "relay.json")
  const given = argValue(argv, "--public-url") ?? env.RELAY_PUBLIC_URL
  let publicUrl = given
  if (!publicUrl && fs.existsSync(saved))
    publicUrl = (JSON.parse(fs.readFileSync(saved, "utf8")) as { publicUrl?: string }).publicUrl
  if (!publicUrl)
    throw new Error(
      "Give the https address your phone uses once, for example: npm run relay -- --public-url https://my-laptop.my-tailnet.ts.net",
    )
  if (!isAllowedPublicUrl(publicUrl))
    throw new Error(
      "The public address must start with https:// (http://localhost is allowed for testing)",
    )
  const origin = new URL(publicUrl).origin
  if (given) {
    // Changing the address later breaks the passkey, so a different saved address is refused rather than overwritten.
    if (fs.existsSync(saved)) {
      const old = (JSON.parse(fs.readFileSync(saved, "utf8")) as { publicUrl?: string }).publicUrl
      if (old && new URL(old).origin !== origin)
        throw new Error(
          `This Relay was set up for ${old}. A different address would break every paired phone. Delete ${saved} (and re-pair phones) to change it.`,
        )
    }
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(saved, JSON.stringify({ publicUrl: origin }, null, 2) + "\n")
  }
  return {
    publicUrl: origin,
    dataDir,
    phoneDist:
      argValue(argv, "--phone-dist") ??
      env.RELAY_PHONE_DIST ??
      path.resolve(here, "../../phone/dist"),
    port: Number(argValue(argv, "--port") ?? env.RELAY_PORT ?? 8087),
    host: env.RELAY_HOST ?? "127.0.0.1",
  }
}
