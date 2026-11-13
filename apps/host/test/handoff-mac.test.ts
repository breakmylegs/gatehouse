import { describe, expect, it } from "vitest"
import { handOff, type Launcher } from "../src/chat/handoff.js"
import {
  findEdgeMac,
  hasAppLinkMac,
  MAC_CLAUDE_APP,
  MAC_EDGE,
  macOpenArgs,
} from "../src/chat/handoff-mac.js"

describe("Open in Claude on a Mac", () => {
  it("finds Edge and the Claude app where a Mac installs them, and nothing when they are not there", async () => {
    expect(await findEdgeMac((p) => p === MAC_EDGE)).toBe(MAC_EDGE)
    expect(await findEdgeMac(() => false)).toBeUndefined()
    expect(await hasAppLinkMac((p) => p === MAC_CLAUDE_APP)).toBe(true)
    expect(await hasAppLinkMac(() => false)).toBe(false)
  })

  it("hands open(1) only a web or claude:// address, never something it could read as an option or a file", () => {
    expect(macOpenArgs("https://claude.ai/new")).toEqual(["https://claude.ai/new"])
    expect(macOpenArgs("claude://claude.ai/new")).toEqual(["claude://claude.ai/new"])
    for (const bad of ["-a Terminal", "/Applications/Calculator.app", "file:///etc/hosts"])
      expect(() => macOpenArgs(bad)).toThrow(/Only a web address/)
  })

  it("opens Mac Edge as an app window with the same two arguments as on Windows", async () => {
    const started: Array<{ file: string; args: string[] }> = []
    const launcher: Launcher = {
      detached: (file, args) => started.push({ file, args }),
      open: async () => undefined,
    }
    const r = await handOff(
      "https://claude.ai/new",
      {},
      { launcher, findEdge: () => findEdgeMac(() => true), hasAppLink: async () => false },
    )
    expect(r.target).toBe("edge")
    expect(started).toEqual([
      { file: MAC_EDGE, args: ["--app=https://claude.ai/new", "--profile-directory=Default"] },
    ])
  })
})
