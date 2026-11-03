// Where each @gatehouse package's entry points are, read from the packages' own package.json (exports, else main), so
// the tools find them in the repository without going through the node_modules\@gatehouse links. npm makes those links
// as junctions, and a process running with Windows' redirection guard on (as a sandboxed agent session can) is refused
// at every junction made by an ordinary user: "untrusted mount point". The files are the same either way.
//
// Used by vitest.config.ts and the Vite configs. tsconfig.base.json lists the same in "paths" for tsc, tsx and
// esbuild; apps/host/test/workspace-aliases.test.ts checks the two agree.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Every entry point as [import name, file], most specific first. */
export function workspaceEntries() {
  const out = []
  for (const dir of ["apps", "packages"])
    for (const name of fs.readdirSync(path.join(root, dir))) {
      const at = path.join(root, dir, name)
      let pkg
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(at, "package.json"), "utf8"))
      } catch {
        continue
      }
      if (typeof pkg.name !== "string" || !pkg.name.startsWith("@gatehouse/")) continue
      const exp = pkg.exports ?? (pkg.main ? { ".": pkg.main } : undefined)
      if (!exp) continue
      for (const [key, file] of Object.entries(typeof exp === "string" ? { ".": exp } : exp))
        if (typeof file === "string")
          out.push([key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`, path.join(at, file)])
    }
  return out.sort((a, b) => b[0].length - a[0].length)
}

/** For Vite and Vitest: an exact match for each name. */
export function workspaceAliases() {
  return workspaceEntries().map(([name, file]) => ({
    find: new RegExp(`^${name.replace(/[/.]/g, (c) => `\\${c}`)}$`),
    replacement: file,
  }))
}
