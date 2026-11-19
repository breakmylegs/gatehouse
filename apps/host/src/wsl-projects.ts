import { execFile } from "node:child_process"

/**
 * T-008: projects inside a WSL distro. Claude Code stays the bundled Windows binary (invariant 6: only it is run, and
 * signed in through Anthropic's own flow); the project lives in the distro and is opened by its Windows path
 * (\\wsl.localhost\<distro>\...), so the file tools, the floor (which denies the distro's home secrets) and the rules
 * see it as any folder. A session in one is told to run its commands inside the distro through wsl.exe, which the
 * rules unwrap and judge as the Linux command it runs (E-028). The distros are listed for the start form, each with
 * its home folder; nothing is installed, and a distro that is not there is simply not offered.
 */
export interface WslPath {
  distro: string
  /** The path inside Linux: /home/you/project. */
  linux: string
}

const UNC = /^[\\/]{2}(wsl\.localhost|wsl\$)[\\/]([^\\/]+)([\\/].*)?$/i
const DISTRO = /^[\w.-]{1,64}$/

/** The distro and Linux path of a Windows path into WSL, or undefined for any other path. */
export function wslPathOf(p: string): WslPath | undefined {
  const m = UNC.exec(p.trim())
  if (!m || !DISTRO.test(m[2]!)) return undefined
  const linux = (m[3] ?? "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/"
  return { distro: m[2]!, linux }
}

/** The Windows path of a Linux path in a distro. */
export const uncOf = (distro: string, linux: string) => `\\\\wsl.localhost\\${distro}${linux.replace(/\//g, "\\")}`

/** A Linux path as a single shell word. */
const shellWord = (s: string) => (/^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

/** What a session in a WSL project is told, or nothing for a folder that is not in WSL. */
export function wslNote(cwd: string): string {
  const w = wslPathOf(cwd)
  if (!w) return ""
  const run = `wsl.exe -d ${w.distro} --cd ${shellWord(w.linux)} -- <command>`
  return [
    `This project is inside the WSL distro ${w.distro}, at ${w.linux} (Windows sees it as ${cwd}).`,
    `Read and edit its files by their Windows paths as usual, but run every command inside the distro, so it uses the distro's own tools: ${run}`,
    `For example: wsl.exe -d ${w.distro} --cd ${shellWord(w.linux)} -- npm test`,
  ].join("\n")
}

function run(args: string[], timeout = 15_000): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    execFile("wsl.exe", args, { windowsHide: true, timeout, encoding: "buffer", maxBuffer: 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out))),
  )
}

/** wsl.exe --list writes UTF-16; anything else it writes is UTF-8. */
export function decodeWslOutput(buf: Buffer): string {
  const utf16 = buf.length >= 2 && (buf[1] === 0 || (buf[0] === 0xff && buf[1] === 0xfe))
  return (utf16 ? buf.toString("utf16le") : buf.toString("utf8")).replace(/^﻿/, "").replace(/\0/g, "")
}

/** The distros' names from wsl.exe --list --quiet, without Docker's own. */
export function distroNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => DISTRO.test(l) && !/^docker-desktop/i.test(l))
}

/** The distros on this computer, each with its home folder as Windows sees it. None when WSL is not there. */
export async function listDistros(exec: (args: string[]) => Promise<Buffer> = run): Promise<Array<{ name: string; home?: string }>> {
  let names: string[]
  try {
    names = distroNames(decodeWslOutput(await exec(["--list", "--quiet"])))
  } catch {
    return []
  }
  return await Promise.all(
    names.slice(0, 10).map(async (name) => {
      try {
        const home = decodeWslOutput(await exec(["-d", name, "-e", "sh", "-c", 'printf %s "$HOME"'])).trim()
        return /^\/[\w@.\/-]{0,200}$/.test(home) ? { name, home: uncOf(name, home) } : { name }
      } catch {
        return { name }
      }
    }),
  )
}
