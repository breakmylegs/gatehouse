import { spawn } from "node:child_process"
import fs from "node:fs"
import { HandoffError, type Launcher } from "./handoff.js"

// Mac fork: Open in Claude, and the browser tools' page look, on a Mac. Kept out of handoff.ts so upstream's changes
// merge without conflicts; findEdge(), hasAppLink() and bootstrap.ts choose these on a Mac (see docs/mac.md).

/** Where Edge installs on a Mac. Its program takes the same --app and --profile-directory as on Windows. */
export const MAC_EDGE = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
/** The official Claude app, which registers the claude:// link on a Mac when installed. */
export const MAC_CLAUDE_APP = "/Applications/Claude.app"

export async function findEdgeMac(exists = fs.existsSync): Promise<string | undefined> {
  return exists(MAC_EDGE) ? MAC_EDGE : undefined
}

export async function hasAppLinkMac(exists = fs.existsSync): Promise<boolean> {
  return exists(MAC_CLAUDE_APP)
}

/**
 * open(1)'s arguments for an address: the address alone. Only https and claude:// addresses are passed on (handOff
 * builds only those), so open never reads one as an option or a file.
 */
export function macOpenArgs(url: string): string[] {
  if (!/^(https|claude):\/\//.test(url)) throw new HandoffError("Only a web address can be opened.")
  return [url]
}

/** The Mac launcher: open(1) hands the address to the default browser, or to the Claude app for claude://. */
export const macLauncher: Launcher = {
  detached: (file, args) => {
    const child = spawn(file, args, { detached: true, stdio: "ignore" })
    child.on("error", () => undefined)
    child.unref()
  },
  open: async (url) => {
    const args = macOpenArgs(url)
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/open", args, { stdio: "ignore" })
      child.on("error", reject)
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new HandoffError("The address could not be opened.")),
      )
    })
  },
}
