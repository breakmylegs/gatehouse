// Points app\node_modules\@gatehouse\<name> at this folder's own workspace packages (app\apps\..., app\packages\...).
// npm makes these links as Windows junctions, which hold absolute paths, so they go wrong when the JCVC folder is
// moved, installed or updated. JCVC.exe and JCVC-Console.exe run this before the Host on every start. It changes
// nothing when the links are right, and it never deletes a link's target.
//
// Usage: node scripts/links.mjs [app folder]   (default: the folder above this script)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const app = path.resolve(
  process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
)
const list = path.join(app, "workspace-links.json")
if (!fs.existsSync(list)) process.exit(0)
const links = JSON.parse(fs.readFileSync(list, "utf8"))
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
let fixed = 0
for (const { link, target } of links) {
  const l = path.resolve(app, link)
  const t = path.resolve(app, target)
  // Only inside this app folder, in both directions.
  if (!l.startsWith(app + path.sep) || !t.startsWith(app + path.sep)) continue
  if (!fs.existsSync(t)) {
    console.error(`[links] ${target} is missing, so ${link} was left as it is`)
    continue
  }
  let st
  try {
    st = fs.lstatSync(l)
  } catch {
    st = undefined
  }
  if (st?.isSymbolicLink() && same(fs.readlinkSync(l), t)) continue
  // A link pointing elsewhere is removed as a link; a copied folder (an installer may copy instead of linking) as a
  // folder. Either way the target is untouched.
  if (st) fs.rmSync(l, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(l), { recursive: true })
  fs.symlinkSync(t, l, "junction")
  fixed++
}
if (fixed)
  console.error(`[links] pointed ${fixed} workspace link${fixed === 1 ? "" : "s"} at ${app}`)
