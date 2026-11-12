// D-048, the architecture review pack: an arc42 document with every section present, filled from the project's own
// sources, and each section with no source marked as a gap.
import { describe, expect, it } from "vitest"
import { arc42, ARC42_SECTIONS } from "../src/arc42.js"
import type { Adr } from "../src/adr.js"

describe("the architecture review pack (D-048)", () => {
  it("has every arc42 section, filled where there is a source and marked as a gap where there is none", () => {
    const adr: Adr = { file: "docs/adr/0001-postgres.md", title: "0001. Use PostgreSQL", status: "accepted", outcome: '"PostgreSQL".', forbids: [], pathGlobs: [] }
    const r = arc42({
      project: "shop",
      date: "2026-11-12",
      requirements: [{ id: "REQ-001", title: "Users can sign in", file: "docs/requirements/REQ-001.md", tests: [], files: [], body: "" }],
      diagrams: { context: "C4Context", container: "C4Container", component: "C4Component" },
      adrs: [adr],
      fitness: { checks: [{ id: "maxFileLines", title: "Longest source file", limit: 400, ok: true }], failed: 0 },
      drift: { newModules: [], newCrossings: [], newCycles: [["src/a", "src/b"]] },
      deployment: [],
      threats: [],
    })
    for (const [i, s] of ARC42_SECTIONS.entries()) expect(r.markdown).toContain(`## ${i + 1}. ${s}`)
    expect(r.gaps).toEqual(["Architecture Constraints", "Runtime View", "Deployment View", "Crosscutting Concepts", "Glossary"])
    expect(r.markdown).toContain("- **REQ-001** Users can sign in")
    expect(r.markdown).toContain("- [0001. Use PostgreSQL](docs/adr/0001-postgres.md)")
    expect(r.markdown).toContain("- An import cycle: src/a, src/b.")
    expect(r.markdown).toContain("```mermaid\nC4Context\n```")
    expect(r.markdown.match(/\*\*Gap:\*\*/g)).toHaveLength(5)
  })
})
