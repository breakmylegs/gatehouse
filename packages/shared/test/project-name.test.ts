import { describe, expect, it } from "vitest"
import { PROJECTS_FOLDER } from "../src/node/config.js"
import { cleanName, projectName } from "../src/project-name.js"

describe("a new project's folder name, from the first prompt", () => {
  it.each([
    ["Build me an HTML page that acts like a simple version of excel", "html-excel"],
    ["Make a todo app with React", "todo-react"],
    ["Create a website for my bakery", "bakery-website"],
    ["I want a dashboard showing my Strava runs", "strava-runs"],
    ["Build a snake game", "snake-game"],
    ["2048 clone in vanilla JS", "2048-clone-vanilla"],
  ])("%s", (prompt, name) => expect(projectName(prompt)).toBe(name))

  it("is never empty and never too long", () => {
    expect(projectName("Please can you build me something?")).toBe("project")
    expect(projectName("")).toBe("project")
    expect(
      projectName("supercalifragilisticexpialidocious antidisestablishmentarianism words"),
    ).toHaveLength(40)
    expect(
      projectName("supercalifragilisticexpialidocious antidisestablishmentarianism"),
    ).not.toMatch(/-$/)
  })

  it("makes a typed name safe for a folder", () => {
    expect(cleanName("  My Bakery: Site! ")).toBe("my-bakery-site")
    expect(cleanName("..\\..\\Windows")).toBe("windows")
    expect(cleanName("???")).toBe("")
  })
})

describe("where new projects may go", () => {
  it.each([
    "C:\\dev",
    "C:/dev",
    "D:\\work\\projects",
    "C:\\Users\\me\\source\\repos",
    "C:\\windows-apps",
  ])("accepts %s", (p) => expect(PROJECTS_FOLDER.test(p)).toBe(true))
  it.each([
    "C:\\",
    "C:",
    "dev",
    "\\\\server\\share\\dev",
    "C:\\Windows",
    "C:\\windows\\temp",
    "C:\\Program Files\\x",
    "C:\\Program Files (x86)\\x",
    "C:\\dev\\a|b",
  ])("refuses %s", (p) => expect(PROJECTS_FOLDER.test(p)).toBe(false))
})
