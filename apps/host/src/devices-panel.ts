import { execFile } from "node:child_process"

/**
 * T-118 (in part): a device beside the session. When the Android tools (adb) are on this computer, or Xcode's simulator
 * tools on a Mac, the running emulators and simulators are listed and one can be shown as a picture, taken when you
 * ask. Nothing is installed, and Claude gets no device tools from this: what a session does to a device stays its own
 * commands, through the Approver.
 */
export interface Device {
  kind: "android" | "ios"
  id: string
  name: string
}

export type Run = (cmd: string, args: string[], binary?: boolean) => Promise<Buffer>

const run: Run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, timeout: 15_000, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out))),
  )

const ID = /^[\w.:-]{1,100}$/

/** adb devices -l: each running device, with its model when it gives one. */
export function parseAdb(text: string): Device[] {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((l) => /^(\S+)\s+device\b(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m && ID.test(m[1]!))
    .map((m) => ({ kind: "android" as const, id: m[1]!, name: (/model:(\S+)/.exec(m[2]!)?.[1] ?? m[1]!).replace(/_/g, " ") }))
}

/** xcrun simctl list devices booted --json: each booted simulator. */
export function parseSimctl(text: string): Device[] {
  try {
    const v = JSON.parse(text) as { devices?: Record<string, Array<{ udid?: string; name?: string; state?: string }>> }
    return Object.values(v.devices ?? {})
      .flat()
      .filter((d) => d.state === "Booted" && typeof d.udid === "string" && ID.test(d.udid))
      .map((d) => ({ kind: "ios" as const, id: d.udid!, name: d.name ?? d.udid! }))
  } catch {
    return []
  }
}

export async function listDevices(platform = process.platform, exec: Run = run): Promise<Device[]> {
  const android = await exec("adb", ["devices", "-l"]).then((b) => parseAdb(b.toString("utf8")), () => [])
  const ios = platform === "darwin" ? await exec("xcrun", ["simctl", "list", "devices", "booted", "--json"]).then((b) => parseSimctl(b.toString("utf8")), () => []) : []
  return [...android, ...ios]
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/** A picture of the device's screen as PNG, or undefined when it cannot be taken. Only a listed device id is used. */
export async function screenshot(d: Pick<Device, "kind" | "id">, exec: Run = run): Promise<Buffer | undefined> {
  if (!ID.test(d.id)) return undefined
  try {
    const out = d.kind === "android" ? await exec("adb", ["-s", d.id, "exec-out", "screencap", "-p"], true) : await exec("xcrun", ["simctl", "io", d.id, "screenshot", "--type=png", "-"], true)
    return out.subarray(0, 4).equals(PNG) ? out : undefined
  } catch {
    return undefined
  }
}
