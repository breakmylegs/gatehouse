/**
 * E-028 (expansion, Wave E1): wsl.exe runs a command inside Linux, so the command it runs is decided as the Bash
 * parser and rules would decide it on its own. `wsl -e cmd args` (or --exec) runs cmd with no shell, so its words are
 * quoted back as they were; `wsl cmd args` and `wsl -- cmd args` hand the rest to the Linux shell as it stands. The
 * options before it (-d, -u, --cd, --shell-type and the like) are skipped. WSL's own management (--list, --install,
 * --shutdown and so on) and a bare `wsl` (an interactive shell) run no command of an agent's, so are left to the rules.
 */

const VALUE_OPTIONS = new Set(["-d", "--distribution", "--distribution-id", "-u", "--user", "--cd", "--shell-type"])
const MANAGEMENT =
  /^--?(install|uninstall|list|l|shutdown|status|update|set-default|s|set-version|set-default-version|unregister|export|import|import-in-place|mount|unmount|terminate|t|help|version|v|manage|debug-shell)$/i

/** A word as a Linux shell would read it back unchanged. */
const quote = (word: string) => (/^[\w@%+=:,./~-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)

/** The Linux command line a wsl call runs, from its arguments; undefined when it runs none. */
export function wslCommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ""
    if (VALUE_OPTIONS.has(a.toLowerCase())) {
      i++
      continue
    }
    if (a === "-e" || a.toLowerCase() === "--exec") return args.slice(i + 1).map(quote).join(" ") || undefined
    if (a === "--") return args.slice(i + 1).join(" ") || undefined
    if (MANAGEMENT.test(a)) return undefined
    if (a.startsWith("-")) continue
    return args.slice(i).join(" ")
  }
  return undefined
}

/** The script a `bash -c` (or sh, zsh and the like) runs, from its arguments; undefined when there is none. */
export function shellCommand(args: readonly string[]): string | undefined {
  const at = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined
}
