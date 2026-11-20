// T-087: a codehouse: link gives a draft only: its prompt, with characters you cannot see taken out; nothing else in it
// is used, and the window app hands it over without sending anything.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { readPromptLink } from "../src/lib/prompt-link"

const repo = path.resolve(import.meta.dirname, "../../..")
const ZWSP = String.fromCodePoint(0x200b)
const RLO = String.fromCodePoint(0x202e)
const TAG_A = String.fromCodePoint(0xe0041)

describe("prompt links (T-087)", () => {
  it("gives the prompt of a new-draft link, and says what else it named", () => {
    expect(readPromptLink("codehouse://new?prompt=Fix%20the%20login%20bug")).toEqual({ prompt: "Fix the login bug", removed: [], ignored: [] })
    expect(readPromptLink("codehouse:new?prompt=hi&mode=bypassPermissions&folder=C%3A%5C&account=x")).toEqual({
      prompt: "hi",
      removed: [],
      ignored: ["mode", "folder", "account"],
    })
  })

  it("takes out characters you cannot see and names them", () => {
    const link = `codehouse://new?prompt=${encodeURIComponent(`Run tests${ZWSP}${RLO} then${TAG_A} stop`)}`
    expect(readPromptLink(link)).toEqual({ prompt: "Run tests then stop", removed: ["U+200B", "U+202E", "U+E0041"], ignored: [] })
  })

  it("refuses anything that is not a new draft with a prompt", () => {
    expect(readPromptLink("https://example.com/?prompt=x")).toEqual({ error: "That is not a codehouse: link." })
    expect(readPromptLink("codehouse://run?prompt=x")).toMatchObject({ error: expect.stringMatching(/only open a new draft/) })
    expect(readPromptLink("codehouse://new")).toEqual({ error: "The link has no prompt." })
    expect(readPromptLink(`codehouse://new?prompt=${ZWSP}`)).toEqual({ error: "The link has no prompt." })
    expect(readPromptLink(`codehouse://new?prompt=${"a".repeat(100_001)}`)).toMatchObject({ error: expect.stringMatching(/100,000/) })
    expect(readPromptLink("not a link")).toMatchObject({ error: expect.any(String) })
  })

  it("is registered for you only, removed by the uninstaller, and handed over by the window without sending", () => {
    const app = fs.readFileSync(path.join(repo, "packaging", "CodehouseApp.cs"), "utf8")
    const iss = fs.readFileSync(path.join(repo, "packaging", "installer.iss"), "utf8")
    const key = fs.readFileSync(path.join(repo, "apps", "web", "src", "lib", "quickKey.ts"), "utf8")
    expect(iss).toMatch(/Root: HKCU; Subkey: "Software\\Classes\\codehouse"; .*Flags: uninsdeletekey/)
    expect(iss).toContain('ValueData: """{app}\\Codehouse.exe"" --link ""%1"""')
    // The window registers it only from the installed copy, under your Programs folder, in HKCU.
    expect(app).toMatch(/if \(!exe\.StartsWith\(programs, StringComparison\.OrdinalIgnoreCase\)\) return;/)
    expect(app).not.toMatch(/Registry\.LocalMachine/)
    expect(app).toContain('Tell("open-link:" + link)')
    expect(key).toContain('m.startsWith("open-link:")')
    // The page opens a draft; it sends nothing for a link.
    const branch = key.slice(key.indexOf('m.startsWith("open-link:")'), key.indexOf("// T-005"))
    expect(branch).not.toMatch(/send\(|create_session|prompt"/)
  })
})
