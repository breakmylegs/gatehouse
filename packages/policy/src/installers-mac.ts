/**
 * Mac fork: D-096 on a Mac. Upstream's installer admission (installers.ts) knows Windows' installers; a Mac installs
 * software with Homebrew, MacPorts, Apple's installer, softwareupdate and the Mac App Store's mas, each of which, like
 * winget, changes the computer, not the project, and runs a publisher's code with your rights. They are found here and
 * go through the same rule: High, named with what they install and from where, never approved by Extreme approval.
 * installers.ts calls this (see docs/mac.md). sudo, env and the other wrappers are looked through.
 */
import { baseCommandName, unwrapVariants, type Segment } from "./segments.js"

export interface MacInstall {
  tool: string
  id: string | undefined
  source: string
}

const flagValue = (args: string[], ...names: string[]) => {
  const i = args.findIndex((a) => names.includes(a))
  return i >= 0 ? args[i + 1] : undefined
}
const plain = (args: string[]) => args.filter((a) => !a.startsWith("-"))

/** One command, as its name and arguments, if it installs software on a Mac. */
function installs(name: string, args: string[]): MacInstall | undefined {
  const sub = args[0]
  const rest = args.slice(1)
  if (name === "brew" && ["install", "reinstall", "upgrade", "tap", "bundle"].includes(sub ?? "")) {
    const names = plain(rest)
    const cask = rest.includes("--cask")
    if (sub === "tap")
      return { tool: "brew tap", id: names[0], source: names[1] ?? "GitHub, as a new Homebrew tap" }
    if (sub === "bundle")
      return { tool: "brew bundle", id: flagValue(rest, "--file") ?? "everything in the Brewfile", source: "Homebrew" }
    // user/repo/formula comes from that tap; a bare name from Homebrew's own.
    const tap = names.find((n) => n.split("/").length === 3)
    return {
      tool: cask ? "brew (an app, as a cask)" : "brew",
      id: names.length ? names.join(", ") : sub === "upgrade" ? "every outdated package" : undefined,
      source: tap ? `the tap ${tap.split("/").slice(0, 2).join("/")}` : cask ? "Homebrew's casks" : "Homebrew",
    }
  }
  if (name === "port" && ["install", "upgrade", "selfupdate"].includes(sub ?? ""))
    return { tool: "port", id: plain(rest).join(", ") || (sub === "selfupdate" ? "MacPorts itself" : undefined), source: "MacPorts" }
  // installer installs only with a package and a target; -pkginfo, -dominfo, -volinfo and -query only read.
  const asks = ["-pkginfo", "-dominfo", "-volinfo", "-query", "-showChoicesXML", "-showChoicesAfterApplyingChangesXML"]
  if (name === "installer" && args.includes("-pkg") && args.includes("-target") && !args.some((a) => asks.includes(a))) {
    const pkg = flagValue(args, "-pkg")
    return { tool: "installer", id: pkg, source: pkg && /^https?:/i.test(pkg) ? "a web address" : "a package file" }
  }
  if (name === "softwareupdate" && args.some((a) => ["-i", "--install", "-a", "--all", "--install-rosetta", "--fetch-full-installer"].includes(a)))
    return { tool: "softwareupdate", id: plain(args).join(", ") || "every update it finds", source: "Apple" }
  if (name === "mas" && ["install", "purchase", "upgrade", "lucky"].includes(sub ?? ""))
    return { tool: "mas", id: plain(rest).join(", ") || "every outdated app", source: "the Mac App Store" }
  return undefined
}

/** What a shell segment installs on a Mac, looking through sudo and the other wrappers; undefined if nothing. */
export function macInstaller(seg: Segment): MacInstall | undefined {
  for (const variant of unwrapVariants(seg)) {
    const [name = "", ...args] = variant.split(" ")
    const found = installs(baseCommandName(name), args)
    if (found) return found
  }
  return undefined
}
