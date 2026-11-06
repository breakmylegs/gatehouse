// The changelog in Settings (owner, 4 Nov): every release's notes and date, read like an update, kept for offline.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ChangelogStore,
  parseChangelog,
  registerChangelogRoutes,
  whatIsNew,
} from "../src/update/changelog.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-changelog-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const file = (releases: unknown[]) => Buffer.from(JSON.stringify({ releases }))

describe("the changelog", () => {
  it("lists every release newest first by version, leaving out anything that is not a Codehouse release", () => {
    const list = parseChangelog(
      JSON.stringify({
        releases: [
          { version: "2.0.9", date: "2026-11-01T10:00:00Z", notes: "- Nine." },
          { version: "2.0.97", date: "2026-11-06T10:00:00Z", notes: "- Ninety-seven." },
          { version: "not a version", date: "x", notes: "-" },
          { version: "2.0.9", date: "again", notes: "- A repeat." },
          { notes: "no version" },
        ],
        futureField: true,
      }),
    )
    expect(list?.map((r) => r.version)).toEqual(["2.0.97", "2.0.9"])
    expect(list?.[1]?.notes).toBe("- Nine.")
    expect(parseChangelog("<html>")).toBeUndefined()
    expect(parseChangelog(JSON.stringify({ other: 1 }))).toBeUndefined()
  })

  it("takes a release's What is new notes from its GitHub page, or all of an older page but the download part", () => {
    const body = [
      "## Download",
      "",
      "- the installer",
      "",
      "## What is new",
      "",
      "### Every platform",
      "- /btw side questions.",
      "",
      "## The other files",
      "",
      "changes.json lists...",
    ].join("\r\n")
    expect(whatIsNew(body)).toBe("### Every platform\n- /btw side questions.")
    expect(whatIsNew("## Download\n\n- x\n\n## Fixes\n- One.")).toBe("## Fixes\n- One.")
    expect(whatIsNew("- Small fixes.")).toBe("- Small fixes.")
  })

  it("keeps the last copy read, shows it offline, and reads GitHub again only hourly unless asked", async () => {
    let now = Date.parse("2026-11-06T09:00:00Z")
    let answer: Buffer | Error = file([{ version: "2.0.97", date: "d", notes: "- New." }])
    let reads = 0
    const store = new ChangelogStore({
      file: path.join(dir, "changelog.json"),
      now: () => now,
      fetch: async () => {
        reads++
        if (answer instanceof Error) throw answer
        return answer
      },
    })
    expect(await store.read()).toMatchObject({
      releases: [{ version: "2.0.97" }],
      readAt: "2026-11-06T09:00:00.000Z",
    })
    now += 30 * 60_000
    await store.read()
    expect(reads).toBe(1)
    answer = new Error("offline")
    expect(await store.read(true)).toMatchObject({ releases: [{ version: "2.0.97" }], offline: true })
    // A page that is not a changelog never replaces the copy kept.
    answer = Buffer.from("<html>sign in</html>")
    expect((await store.read(true)).releases).toHaveLength(1)
    // A new store, as after a restart, still has it.
    const again = new ChangelogStore({
      file: path.join(dir, "changelog.json"),
      now: () => now,
      fetch: async () => {
        throw new Error("offline")
      },
    })
    expect((await again.read()).releases[0]?.version).toBe("2.0.97")
  })

  it("is served at /api/changelog", async () => {
    const app = Fastify()
    registerChangelogRoutes(
      app,
      new ChangelogStore({
        file: path.join(dir, "c.json"),
        fetch: async () => file([{ version: "2.0.1", date: "d", notes: "- One." }]),
      }),
    )
    const r = await app.inject({ method: "GET", url: "/api/changelog?fresh=1" })
    expect(r.json().releases).toEqual([{ version: "2.0.1", date: "d", notes: "- One." }])
    await app.close()
  })
})
