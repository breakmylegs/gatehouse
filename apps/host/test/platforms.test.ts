// Each release says which change is for which platform, for a fork on another system (owner, 4 Nov: a Mac fork).
import { describe, expect, it } from "vitest"
import { kindOf, notesFor, parseLog, platformOf } from "../../../scripts/platforms.js"

describe("which platform a change is for", () => {
  it("knows the Windows-only parts, this repository's own release tools, the docs, and the rest", () => {
    expect(kindOf("packaging/CodehouseApp.cs")).toBe("windows")
    expect(kindOf("scripts/installer.mjs")).toBe("windows")
    expect(kindOf("apps\\host\\src\\limits.ts")).toBe("windows")
    expect(kindOf("apps/host/src/update/stage.ts")).toBe("windows")
    expect(kindOf("scripts/release.ts")).toBe("release")
    expect(kindOf("docs/plan/wave-2.md")).toBe("docs")
    expect(kindOf("apps/web/src/surfaces/Workspace.tsx")).toBe("all")
    expect(kindOf("packages/policy/src/engine.ts")).toBe("all")
  })

  it("calls a commit Windows only, for every platform, or both with Windows parts", () => {
    expect(platformOf(["packaging/Overlay.cs", "docs/packaging.md"])).toBe("windows")
    expect(platformOf(["apps/host/src/sessions.ts", "docs/BUILD_REPORT.md"])).toBe("all")
    expect(platformOf(["apps/host/src/sessions.ts", "packaging/Popout.cs"])).toBe("mixed")
    expect(platformOf(["scripts/release.ts"])).toBe("release")
    expect(platformOf(["README.md"])).toBe("docs")
    expect(platformOf([])).toBe("all")
  })

  it("reads git's log into changes, and groups the notes by platform, leaving out release and docs work", () => {
    const log = [
      "\x1eaaa\x1ffeat: a paste card\n\napps/web/src/surfaces/Workspace.tsx\n",
      "\x1ebbb\x1ffix(shell): the tray icon\n\npackaging/CodehouseApp.cs\n",
      "\x1eccc\x1ffeat: pop out a pane\n\napps/web/src/surfaces/PanePage.tsx\npackaging/Popout.cs\n",
      "\x1eddd\x1fdocs: the queue\n\ndocs/plan/queue.md\n",
    ].join("")
    const list = parseLog(log)
    expect(list.map((c) => [c.commit, c.subject, c.platform])).toEqual([
      ["aaa", "A paste card", "all"],
      ["bbb", "The tray icon", "windows"],
      ["ccc", "Pop out a pane", "mixed"],
      ["ddd", "The queue", "docs"],
    ])
    expect(list[2]?.files).toEqual(["apps/web/src/surfaces/PanePage.tsx", "packaging/Popout.cs"])
    const notes = notesFor(list)
    expect(notes).toContain("### For every platform\n\n- A paste card")
    expect(notes).toContain("### For every platform, with Windows parts\n\n- Pop out a pane")
    expect(notes).toContain("### Windows only\n\n- The tray icon")
    expect(notes).not.toContain("The queue")
  })
})
