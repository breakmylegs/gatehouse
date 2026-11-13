// Mac fork: on a Mac the Relay keeps its data with the rest of Codehouse's, unless an earlier run made ~/.gatehouse-relay.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { macRelayDir } from "../src/config-mac.js"

const made: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gh-relay-mac-"))
  made.push(d)
  return d
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("the Relay's data on a Mac", () => {
  it("is in Application Support with Codehouse's, and only on a Mac", () => {
    const home = tmp()
    expect(macRelayDir(home, "darwin")).toBe(
      path.join(home, "Library", "Application Support", "Gatehouse", "relay"),
    )
    expect(macRelayDir(home, "win32")).toBeUndefined()
    expect(macRelayDir(home, "linux")).toBeUndefined()
  })

  it("stays in ~/.gatehouse-relay when an earlier run made it, so a paired phone stays paired", () => {
    const home = tmp()
    fs.mkdirSync(path.join(home, ".gatehouse-relay"))
    expect(macRelayDir(home, "darwin")).toBe(path.join(home, ".gatehouse-relay"))
  })
})
