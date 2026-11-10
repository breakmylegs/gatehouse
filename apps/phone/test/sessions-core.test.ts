// G32: the sessions snapshot opens only with this phone's key, and only as a sessions snapshot.
import { afterEach, describe, expect, it, vi } from "vitest"
import { generateKeyPair, sealJson } from "@gatehouse/shared/e2e"
import { loadSessions } from "../src/core"

const snapshot = {
  at: "2026-11-09T10:00:00Z",
  sessions: [{ id: "s1", project: "atlas", state: "idle", waiting: 0, latest: "You: hello" }],
}

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

afterEach(() => vi.unstubAllGlobals())

describe("the phone's sessions", () => {
  it("opens what was sealed to this phone as sessions, and an empty list when there is none yet", async () => {
    const keys = await generateKeyPair(false)
    const sealed = await sealJson(snapshot, keys.publicKey, "sessions")
    vi.stubGlobal("fetch", reply(200, { sealed, at: snapshot.at }))
    expect(await loadSessions({ token: "t", expiresAt: 0 }, keys as never)).toEqual(snapshot)
    vi.stubGlobal("fetch", reply(404, { error: "not found" }))
    expect(await loadSessions({ token: "t", expiresAt: 0 }, keys as never)).toEqual({
      at: "",
      sessions: [],
    })
  })

  it("refuses a snapshot sealed as something else, or to another phone", async () => {
    const keys = await generateKeyPair(false)
    const other = await generateKeyPair(false)
    vi.stubGlobal(
      "fetch",
      reply(200, { sealed: await sealJson(snapshot, keys.publicKey, "push"), at: "" }),
    )
    await expect(loadSessions({ token: "t", expiresAt: 0 }, keys as never)).rejects.toThrow()
    vi.stubGlobal(
      "fetch",
      reply(200, { sealed: await sealJson(snapshot, other.publicKey, "sessions"), at: "" }),
    )
    await expect(loadSessions({ token: "t", expiresAt: 0 }, keys as never)).rejects.toThrow()
  })
})
