import { execFile, spawn } from "node:child_process"
import { findEdgeMac, hasAppLinkMac } from "./handoff-mac.js" // Mac fork

/**
 * Open in Claude (the owner's Chat build, CH-06): a chat or project from claude.ai opens in claude.ai itself, in a
 * separate program, and Codehouse reads nothing back. Sign-in happens there, in Edge or the Claude app; Codehouse
 * never sees it. Only https addresses on claude.ai, built from a template and a checked uuid, are ever opened.
 */

export type HandoffTarget = "edge" | "browser" | "app"

export interface HandoffSettings {
  /** Edge app window (the default), the official Claude app, or your default browser. */
  target?: HandoffTarget
  /** The Edge profile to open it in: Default, or one such as "Profile 1". */
  edgeProfile?: string
  /** The official app's claude:// link is not documented by Anthropic, so it is off until you turn it on. */
  appLink?: boolean
  templates?: { chat?: string; project?: string; new?: string }
}

export const DEFAULT_TEMPLATES = {
  chat: "https://claude.ai/chat/{uuid}",
  project: "https://claude.ai/project/{uuid}",
  new: "https://claude.ai/new",
}

export class HandoffError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The names Edge gives its profile folders: Default, Profile 1, Profile 2 and so on, and Guest Profile. */
const PROFILE = /^(Default|Profile \d{1,3}|Guest Profile)$/

/** The address to open, from a template: only https on claude.ai itself, with a uuid in the right shape. */
export function handoffUrl(
  kind: "chat" | "project" | "new",
  uuid: string | undefined,
  templates: HandoffSettings["templates"] = {},
): string {
  const template = templates[kind] ?? DEFAULT_TEMPLATES[kind]
  if (kind !== "new" && (!uuid || !UUID.test(uuid)))
    throw new HandoffError("That is not a claude.ai chat or project id.")
  const text = template.replace("{uuid}", uuid ?? "")
  let u: URL
  try {
    u = new URL(text)
  } catch {
    throw new HandoffError("The address to open is not a web address.")
  }
  if (u.protocol !== "https:" || u.hostname !== "claude.ai" || u.username || u.password || u.port)
    throw new HandoffError("Only claude.ai itself can be opened from here.")
  return u.toString()
}

/** Exactly the two arguments Edge is given, nothing else (the owner's prompt). */
export function edgeArgs(url: string, profile = "Default"): [string, string] {
  if (!PROFILE.test(profile)) throw new HandoffError("That is not an Edge profile name.")
  return [`--app=${url}`, `--profile-directory=${profile}`]
}

type Run = (file: string, args: string[]) => Promise<string>
const run: Run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 10_000 }, (err, out) =>
      err ? reject(err) : resolve(String(out)),
    ),
  )

/** msedge.exe from the registry's App Paths key, as Windows itself finds it: never a path written here. */
export async function findEdge(query: Run = run): Promise<string | undefined> {
  if (process.platform === "darwin") return findEdgeMac() // Mac fork
  const key = "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe"
  for (const hive of ["HKCU", "HKLM"]) {
    try {
      const out = await query("reg", ["query", `${hive}\\${key}`, "/ve"])
      const m = /REG_(?:EXPAND_)?SZ\s+(.+\.exe)\s*$/im.exec(out)
      if (m) return m[1]!.trim().replace(/^"|"$/g, "")
    } catch {
      // not in this hive
    }
  }
  return undefined
}

/** Whether Windows knows the claude:// link (the official app registers it when installed). */
export async function hasAppLink(query: Run = run): Promise<boolean> {
  if (process.platform === "darwin") return hasAppLinkMac() // Mac fork
  for (const key of ["HKCU\\Software\\Classes\\claude", "HKCR\\claude"]) {
    try {
      const out = await query("reg", ["query", key, "/v", "URL Protocol"])
      if (/URL Protocol/i.test(out)) return true
    } catch {
      // not registered here
    }
  }
  return false
}

export interface Launcher {
  /** Starts a program on its own: no output read, no handle kept. */
  detached: (file: string, args: string[]) => void
  /** Opens an address with the program Windows has for it (the default browser, or the Claude app). */
  open: (url: string) => Promise<void>
}

export const realLauncher = (helperExe: () => string | undefined): Launcher => ({
  detached: (file, args) => {
    const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false })
    child.on("error", () => undefined)
    child.unref()
  },
  open: async (url) => {
    const exe = helperExe()
    if (!exe) throw new HandoffError("Opening your browser needs Codehouse-Helper.exe.")
    // The address travels in the environment, never on a command line (see packaging/Helper.cs).
    await new Promise<void>((resolve, reject) => {
      const child = spawn(exe, ["--open-url"], {
        env: { ...process.env, CODEHOUSE_OPEN_URL: url },
        stdio: "ignore",
        windowsHide: true,
      })
      child.on("error", reject)
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new HandoffError("The address could not be opened.")),
      )
    })
  },
})

/** Opens the address in the target chosen, and says which was used (the app falls back to Edge when unknown). */
export async function handOff(
  url: string,
  s: HandoffSettings,
  deps: {
    launcher: Launcher
    findEdge: () => Promise<string | undefined>
    hasAppLink: () => Promise<boolean>
  },
): Promise<{ target: HandoffTarget; opened: string }> {
  const target = s.target ?? "edge"
  if (target === "app" && s.appLink === true && (await deps.hasAppLink())) {
    const app = `claude://${url.replace(/^https:\/\//, "")}`
    await deps.launcher.open(app)
    return { target: "app", opened: app }
  }
  if (target === "browser") {
    await deps.launcher.open(url)
    return { target: "browser", opened: url }
  }
  const edge = await deps.findEdge()
  if (!edge) throw new HandoffError("Microsoft Edge was not found on this computer.")
  deps.launcher.detached(edge, edgeArgs(url, s.edgeProfile))
  return { target: "edge", opened: url }
}
