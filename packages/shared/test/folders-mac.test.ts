import { describe, expect, it } from "vitest"
import {
  folderExample,
  isFullFolder,
  MAC_PROJECTS_FOLDER,
  PROJECTS_FOLDER,
} from "../src/node/index.js"

describe("project folders on a Mac", () => {
  it.each([
    "/Users/you/dev",
    "/Users/you/Documents/Projects",
    "/Volumes/Work/dev",
    "/opt/projects",
    "/Users/you/My Projects",
  ])("takes %s as a projects folder", (p) => expect(MAC_PROJECTS_FOLDER.test(p)).toBe(true))

  it.each([
    "/",
    "/System",
    "/System/Library/x",
    "/Library/LaunchDaemons",
    "/library",
    "/Applications",
    "/usr/local",
    "/bin",
    "/etc",
    "/private/etc",
    "/var/tmp",
    "/Volumes",
    "/Volumes/",
    "/Users/you/../../System",
    "relative/folder",
    "C:\\dev",
  ])("refuses %s", (p) => expect(MAC_PROJECTS_FOLDER.test(p)).toBe(false))

  it("leaves Windows as it was: a drive path, and never a Mac one", () => {
    expect(PROJECTS_FOLDER.test("C:\\dev")).toBe(true)
    expect(PROJECTS_FOLDER.test("/Users/you/dev")).toBe(false)
  })

  it("knows a full folder path for each system, and gives examples in each one's form", () => {
    expect(isFullFolder("/Users/you/dev/shop", "darwin")).toBe(true)
    expect(isFullFolder("/", "darwin")).toBe(false)
    expect(isFullFolder("dev/shop", "darwin")).toBe(false)
    expect(isFullFolder("C:\\dev\\shop", "win32")).toBe(true)
    expect(isFullFolder("/Users/you/dev/shop", "win32")).toBe(false)
    expect(folderExample("shop", "darwin")).toBe("/Users/you/dev/shop")
    expect(folderExample("shop", "win32")).toBe("C:\\dev\\shop")
  })
})
