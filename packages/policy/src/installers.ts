/**
 * D-096, WinGet and installer admission (Frontier build, Wave 1). Installing software on Windows (winget, choco, scoop,
 * msiexec, PowerShell's Install-Module and Install-Package) changes the computer, not the project, and runs a
 * publisher's installer with your rights. Each is High, shows what it installs and from where, and Extreme approval
 * never approves one (canuse's NEVER_AUTO_APPROVED).
 */
import { macInstaller } from "./installers-mac.js" // Mac fork
import type { Segment } from "./segments.js"

export const INSTALLER_RULE = "installer-admission"

export interface InstallerFinding {
  ruleId: typeof INSTALLER_RULE
  reason: string
  risk: number
}

const flagValue = (args: string[], ...names: string[]) => {
  const i = args.findIndex((a) => names.includes(a.toLowerCase()))
  return i >= 0 ? args[i + 1] : undefined
}
const firstPlain = (args: string[]) => args.find((a) => !a.startsWith("-") && !a.startsWith("/"))

/** What an installer call installs, from where, and by whom, as far as can be told without a network. */
export function installerCall(segments: Segment[]): InstallerFinding | undefined {
  for (const s of segments) {
    const name = s.name.toLowerCase().replace(/\.exe$/, "")
    const args = s.args
    const sub = args[0]?.toLowerCase()
    let tool: string | undefined
    let id: string | undefined
    let source: string | undefined
    if (name === "winget" && ["install", "upgrade", "add", "update"].includes(sub ?? "")) {
      tool = "winget"
      id = flagValue(args, "--id", "-q", "--query", "--name") ?? firstPlain(args.slice(1))
      source = flagValue(args, "--source", "-s") ?? "winget"
    } else if ((name === "choco" || name === "chocolatey" || name === "cinst") && (name === "cinst" || ["install", "upgrade"].includes(sub ?? ""))) {
      tool = "choco"
      id = firstPlain(args.slice(name === "cinst" ? 0 : 1))
      source = flagValue(args, "--source", "-s") ?? "the Chocolatey community repository"
    } else if (name === "scoop" && ["install", "update"].includes(sub ?? "")) {
      tool = "scoop"
      id = firstPlain(args.slice(1))
      source = id?.includes("/") ? id.split("/")[0] : "a scoop bucket"
    } else if (name === "msiexec") {
      tool = "msiexec"
      id = flagValue(args, "/i", "/package", "/update", "/p") ?? firstPlain(args)
      source = id && /^https?:/i.test(id) ? "a web address" : "a local file"
    } else if (name === "install-module" || name === "install-package" || name === "install-script") {
      tool = s.name
      id = flagValue(args, "-name") ?? firstPlain(args)
      source = flagValue(args, "-repository", "-source") ?? "PSGallery"
    }
    if (!tool) {
      // Mac fork: the Mac's installers go through the same rule (installers-mac.ts).
      const mac = macInstaller(s)
      if (mac) ({ tool, id, source } = mac)
    }
    if (!tool) continue
    // A WinGet id is Publisher.Package; anything else names no publisher that can be checked here.
    const publisher = tool === "winget" && id && /^[A-Za-z0-9-]+\.[A-Za-z0-9.-]+$/.test(id) ? id.split(".")[0] : undefined
    return {
      ruleId: INSTALLER_RULE,
      reason: `It installs software on this computer with ${tool}: ${id ?? "a package it does not name"}, from ${source}${publisher ? `, published as ${publisher}` : ""} (not checked: Codehouse looks nothing up). An installer runs with your rights, so it is always yours to decide, even in Extreme approval.`,
      risk: 80,
    }
  }
  return undefined
}
