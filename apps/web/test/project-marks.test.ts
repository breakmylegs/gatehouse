// T-092: projects in the sidebar: a monogram and a colour of their own, pinned to the top or archived out of the way,
// with the sidebar's own groups left where they were.
import { describe, expect, it } from "vitest"
import { arrangeSections, hueOf, monogram, setSection } from "../src/lib/project-marks"

const g = (folder: string) => ({ folder, label: folder.replace(/^.*[:/]/, ""), sessions: [] })
const GROUPS = [g("pinned:"), g("working:"), g("project:Launch"), g("c:/dev/shop"), g("c:/dev/site"), g("chats:")]

describe("projects in the sidebar (T-092)", () => {
  it("gives each a monogram and the same colour every time", () => {
    expect(monogram("shop")).toBe("SH")
    expect(monogram("codehouse-site")).toBe("CS")
    expect(monogram("dyelApp")).toBe("DA")
    expect(monogram("--")).toBe("?")
    expect(hueOf("shop")).toBe(hueOf("SHOP"))
    expect(hueOf("shop")).not.toBe(hueOf("site"))
  })

  it("puts pinned projects first, in the order pinned, and leaves archived ones out unless asked", () => {
    let p = { pinned: [] as string[], archived: [] as string[] }
    p = setSection(p, "c:/dev/site", "pin")
    p = setSection(p, "project:Launch", "pin")
    p = setSection(p, "c:/dev/shop", "archive")
    const r = arrangeSections(GROUPS, p)
    expect(r.groups.map((x) => x.folder)).toEqual(["pinned:", "working:", "c:/dev/site", "project:Launch", "chats:"])
    expect(r.archived).toBe(1)
    expect(arrangeSections(GROUPS, p, true).groups.map((x) => x.folder)).toContain("c:/dev/shop")
    // Pinning brings one back from the archive; archiving unpins.
    expect(setSection(p, "c:/dev/shop", "pin")).toEqual({ pinned: ["c:/dev/site", "project:launch", "c:/dev/shop"], archived: [] })
    expect(setSection(p, "c:/dev/site", "archive").pinned).toEqual(["project:launch"])
  })
})
