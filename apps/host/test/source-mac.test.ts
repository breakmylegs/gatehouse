// Mac fork (18 Nov): where a Mac copy reads its updates (GitHubSource with the Mac channel): the newest description from
// the mac-channel release, never Latest, and its signature and parts from the version's own mac-v release. Without the
// channel, Windows' addresses are unchanged.
import { describe, expect, it } from "vitest"
import { MAC_CHANNEL_TAG, MAC_UPDATE_FILE, MAC_UPDATE_SIGNATURE, macTag } from "../src/update/release-mac.js"
import { GitHubSource } from "../src/update/source.js"

const channel = { tag: MAC_CHANNEL_TAG, manifest: MAC_UPDATE_FILE, signature: MAC_UPDATE_SIGNATURE, tagOf: macTag }
const manifest = JSON.stringify({ version: "2.0.444+mac.4" })

/** A fake fetch that answers by address and records each one. */
function fake(answers: Record<string, string>) {
  const asked: string[] = []
  const fetchImpl = (async (u: URL | string) => {
    const url = String(u)
    asked.push(url)
    const body = answers[url]
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 })
  }) as typeof fetch
  return { fetchImpl, asked }
}

describe("where a Mac copy reads its updates", () => {
  it("reads the description from mac-channel and its signature from the version's own release", async () => {
    const f = fake({
      "https://github.com/o/r/releases/download/mac-channel/update-mac.json": manifest,
      "https://github.com/o/r/releases/download/mac-v2.0.444-mac.4/update-mac.sig": "sig",
    })
    const src = new GitHubSource({ repo: "o/r", channel, fetchImpl: f.fetchImpl })
    expect(await src.latest()).toMatchObject({ signature: "sig" })
    expect(f.asked).toEqual([
      "https://github.com/o/r/releases/download/mac-channel/update-mac.json",
      "https://github.com/o/r/releases/download/mac-v2.0.444-mac.4/update-mac.sig",
    ])
    expect(f.asked.some((u) => u.includes("latest"))).toBe(false)
  })

  it("with a token, reads both releases through the API, the parts from the version's own", async () => {
    const api = "https://api.github.com/repos/o/r/releases/tags"
    const f = fake({
      [`${api}/mac-channel`]: JSON.stringify({ tag_name: "mac-channel", assets: [{ name: "update-mac.json", url: "https://api.github.com/a/1" }] }),
      "https://api.github.com/a/1": manifest,
      [`${api}/mac-v2.0.444-mac.4`]: JSON.stringify({
        tag_name: "mac-v2.0.444-mac.4",
        assets: [
          { name: "update-mac.sig", url: "https://api.github.com/a/2" },
          { name: "codeh-mac-2.0.444-mac.4-app.zip", url: "https://api.github.com/a/3" },
        ],
      }),
      "https://api.github.com/a/2": "sig",
    })
    const src = new GitHubSource({ repo: "o/r", channel, token: () => "t", fetchImpl: f.fetchImpl })
    expect(await src.latest()).toMatchObject({ signature: "sig" })
    expect(f.asked).toContain(`${api}/mac-v2.0.444-mac.4`)
    expect(f.asked.some((u) => u.endsWith("releases/latest"))).toBe(false)
  })

  it("leaves Windows' addresses as they were without the channel", async () => {
    const f = fake({
      "https://github.com/o/r/releases/latest/download/update.json": JSON.stringify({ version: "2.0.445" }),
      "https://github.com/o/r/releases/download/v2.0.445/update.sig": "sig",
    })
    expect(await new GitHubSource({ repo: "o/r", fetchImpl: f.fetchImpl }).latest()).toMatchObject({ signature: "sig" })
    expect(f.asked).toEqual([
      "https://github.com/o/r/releases/latest/download/update.json",
      "https://github.com/o/r/releases/download/v2.0.445/update.sig",
    ])
  })
})
