/**
 * E-030 (expansion, Wave E1): a change to the tools every project on this computer uses goes to a person, showing what
 * changes and where. A Node version manager's install or switch (nvm, fnm), rustup, pyenv's install and global, the
 * dotnet-install scripts, and a global install with npm, pnpm, yarn or dotnet tool are High, whatever pack is on.
 */
import type { Segment } from "./segments.js"

export const TOOLCHAIN_RULE = "toolchain-change"
export const TOOLCHAIN_RISK = 80

export interface ToolchainFinding {
  ruleId: typeof TOOLCHAIN_RULE
  reason: string
  risk: number
}

const has = (args: string[], ...names: string[]) => args.some((a) => names.includes(a.toLowerCase()))

function change(seg: Segment): { what: string; risk: number } | undefined {
  // The file name alone: ./dotnet-install.sh and C:\tools\nvm.exe are dotnet-install and nvm.
  const name = (seg.name.split(/[\\/]/).at(-1) ?? "").toLowerCase().replace(/\.(exe|cmd|ps1|sh)$/, "")
  const args = seg.args
  const sub = args.find((a) => !a.startsWith("-"))?.toLowerCase()
  switch (name) {
    case "nvm":
    case "fnm":
      return ["install", "use", "default", "alias", "uninstall"].includes(sub ?? "") ? { what: `${name} ${sub} ${args.slice(1).join(" ")}`.trim(), risk: TOOLCHAIN_RISK } : undefined
    case "rustup":
      return sub && !["show", "which", "--version", "check", "doc", "help"].includes(sub) ? { what: `rustup ${args.join(" ")}`, risk: TOOLCHAIN_RISK } : undefined
    case "pyenv":
      return ["install", "global", "uninstall"].includes(sub ?? "") ? { what: `pyenv ${args.join(" ")}`, risk: TOOLCHAIN_RISK } : undefined
    case "dotnet-install":
      return { what: `the .NET SDK from ${seg.name}`, risk: TOOLCHAIN_RISK }
    case "npm":
    case "pnpm":
      return ["install", "i", "add", "uninstall", "remove", "update", "up", "link"].includes(sub ?? "") && has(args, "-g", "--global", "--location=global")
        ? { what: `${name} ${args.join(" ")} for every project`, risk: TOOLCHAIN_RISK }
        : undefined
    case "yarn":
      return sub === "global" ? { what: `yarn ${args.join(" ")} for every project`, risk: TOOLCHAIN_RISK } : undefined
    case "dotnet":
      return sub === "tool" && has(args, "-g", "--global") ? { what: `dotnet ${args.join(" ")} for every project`, risk: TOOLCHAIN_RISK } : undefined
    // pip install and Set-ExecutionPolicy are not here: the dependency rules (dependency-new, package-install, and the
    // refusal of a name models invent) and pwsh-execution-policy already hold them, with more to say.
    default:
      return undefined
  }
}

/** A change to this computer's toolchain, with what changes; undefined when there is none. */
export function toolchainChange(segments: Segment[], _cwd?: string): ToolchainFinding | undefined {
  for (const s of segments) {
    const c = change(s)
    if (c)
      return {
        ruleId: TOOLCHAIN_RULE,
        reason: `This changes the tools on this computer, not just this project: ${c.what}. So it waits for you.`,
        risk: c.risk,
      }
  }
  return undefined
}
