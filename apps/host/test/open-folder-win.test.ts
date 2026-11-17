// T-002: Codehouse.exe <folder> (or --open <folder>) leaves a folder that exists, as a full path, for the window, the one
// already running included, which opens the start-session form on it once its page is up. This keeps the window's side
// and the page's in step: the same file, read once, and the same message the page handles.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const app = fs.readFileSync(path.join(root, "packaging", "CodehouseApp.cs"), "utf8")
const page = fs.readFileSync(path.join(root, "apps", "web", "src", "lib", "quickKey.ts"), "utf8")

describe("opening a folder from a terminal (T-002)", () => {
  it("takes --open or a folder on its own, only one that exists, as a full path", () => {
    expect(app).toContain('else if (a == "--open" && i + 1 < args.Length) openFolder = args[++i];')
    expect(app).toContain('else if (!a.StartsWith("-") && openFolder == null && Directory.Exists(a)) openFolder = a;')
    expect(app).toMatch(/full = Path\.GetFullPath\(openFolder\)/)
    expect(app).toMatch(/!Directory\.Exists\(full\)\) \{ Console\.WriteLine\("\[gatehouse\] There is no folder/)
  })

  it("is opened by the running window when it is asked to show, and once the page is up, then forgotten", () => {
    expect(app).toContain("form.ShowWindow(); form.OpenPendingFolder();")
    expect(app).toMatch(/PrepareWing\(\);\s+OpenPendingFolder\(\);/)
    expect(app).toMatch(/File\.Delete\(OpenFolderFile\)/)
    expect(app).toContain('Tell("open-folder:" + folder)')
    expect(page).toContain('m.startsWith("open-folder:")')
  })
})
