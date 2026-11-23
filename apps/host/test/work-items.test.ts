// E-056: a branch named AB#1234 links its session and commits; ids in commit messages and the ledger are linked too;
// the export lists them.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { exportLinks, itemsIn, scanLinks, WorkItemStore } from "../src/work-items.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-workitems-"))
  dirs.push(root)
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" }).trim()
  g("init", "-q", "-b", "main")
  fs.writeFileSync(path.join(root, "a.txt"), "1\n")
  g("add", "-A")
  g("commit", "-qm", "start")
  g("checkout", "-q", "-b", "feature/AB#1234-cart-totals")
  fs.writeFileSync(path.join(root, "a.txt"), "2\n")
  g("commit", "-qam", "Round totals to pence", "-m", "Also fixes SHOP-77 and keeps UTF-8 output")
  const sha = g("rev-parse", "HEAD")
  fs.mkdirSync(path.join(root, "docs", "requirements"), { recursive: true })
  fs.writeFileSync(path.join(root, "docs", "requirements", "R-1.md"), "---\nid: R-1\ntitle: Totals in pence\n---\nTracked as AB#1234 and SHOP-80.\n")
  return { root, sha }
}

describe("work item linkage", () => {
  it("links a branch named AB#1234 to its session and its commits", async () => {
    const { root, sha } = repo()
    const links = await scanLinks(root, "s1")
    expect(links).toEqual(
      expect.arrayContaining([
        { item: "AB#1234", kind: "azure-devops", to: "session", ref: "s1", from: "branch" },
        { item: "AB#1234", kind: "azure-devops", to: "commit", ref: sha, from: "branch" },
        { item: "SHOP-77", kind: "jira", to: "commit", ref: sha, from: "commit message" },
        { item: "AB#1234", kind: "azure-devops", to: "requirement", ref: "R-1", from: "ledger" },
        { item: "SHOP-80", kind: "jira", to: "requirement", ref: "R-1", from: "ledger" },
      ]),
    )
    expect(links.some((l) => l.item.startsWith("UTF"))).toBe(false)
    // The commit before the branch is not the branch's.
    expect(links.filter((l) => l.to === "commit").every((l) => l.ref === sha)).toBe(true)
  })

  it("exports the links as CSV and JSON, quoting what a spreadsheet would run", async () => {
    const { root } = repo()
    const links = await scanLinks(root, "s1")
    const csv = exportLinks(links, "csv")
    expect(csv.split("\n")[0]).toBe("item,kind,linked to,ref,found in")
    expect(csv).toContain("AB#1234,azure-devops,session,s1,branch")
    expect(JSON.parse(exportLinks(links, "json"))).toHaveLength(links.length)
    expect(exportLinks([{ item: "AB#1", kind: "azure-devops", to: "session", ref: "=cmd()", from: "branch" }], "csv")).toContain(`"'=cmd()"`)
  })

  it("keeps links per project, merging new ones without repeats", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-wi-store-"))
    dirs.push(d)
    const s = new WorkItemStore(path.join(d, "links.json"))
    const l = { item: "AB#1", kind: "azure-devops" as const, to: "session" as const, ref: "s1", from: "branch" as const }
    s.merge("C:/p", [l])
    expect(s.merge("C:/p", [l, { ...l, ref: "s2" }])).toHaveLength(2)
    expect(s.read("C:/other")).toEqual([])
  })

  it("finds Azure DevOps ids and Jira keys, and leaves look-alikes", () => {
    expect(itemsIn("AB#12 fix, PROJ-3 and ABC1-45; UTF-8, ISO-8601, SHA-256, x-1, AB#")).toEqual([
      { item: "AB#12", kind: "azure-devops" },
      { item: "PROJ-3", kind: "jira" },
      { item: "ABC1-45", kind: "jira" },
    ])
  })
})
