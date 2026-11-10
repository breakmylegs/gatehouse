// C-016, a verified data-boundary card per model: each card is dated, a model's own card says more than its
// provider's, and a send is refused, and recorded, when the card it goes by is stale.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { BoundaryStaleError, cardFor, checkBoundary, refuseStaleSend, staleness, type Boundaries } from "../src/boundary.js"
import { buildStack, type Stack } from "./stack.js"

const NOW = new Date("2026-11-10T12:00:00Z")
const card = (checkedAt?: string) => ({ keeps: "30 days", training: "no", region: "EU", zdr: "no", source: "the terms page", ...(checkedAt ? { checkedAt } : {}) })

describe("data-boundary cards (C-016)", () => {
  it("goes by the model's own card, or else its provider's", () => {
    const b: Boundaries = { claude: card("2026-10-01"), local: card("2026-09-01"), models: { "claude-opus-5-5": card("2026-11-01") } }
    expect(cardFor(b, false, "claude-opus-5-5")?.of).toBe("claude-opus-5-5")
    expect(cardFor(b, false, "claude-sonnet-5-5")?.of).toBe("Claude")
    expect(cardFor(b, true, "llama3")?.of).toBe("models on this computer")
    expect(cardFor({}, false, "x")).toBeUndefined()
  })

  it("is stale when checked longer ago than allowed, or never dated, and a send then is refused", () => {
    expect(staleness(card("2026-06-01"), 180, NOW)).toBeUndefined()
    expect(staleness(card("2026-04-01"), 180, NOW)).toMatch(/last checked on 2026-04-01, 223 days ago, and Settings allows 180/)
    expect(staleness(card(), 180, NOW)).toMatch(/no date/)
    expect(() => checkBoundary({ claude: card("2026-04-01") }, false, "claude-opus-5-5", NOW)).toThrow(BoundaryStaleError)
    // A shorter limit in Settings makes a recent card stale; a model's fresh card lets it through.
    expect(() => checkBoundary({ claude: card("2026-10-01"), maxAgeDays: 30 }, false, "x", NOW)).toThrow(/Settings allows 30/)
    expect(() => checkBoundary({ claude: card("2026-04-01"), models: { x: card("2026-11-01") } }, false, "x", NOW)).not.toThrow()
    // No card at all: not refused (older versions kept none).
    expect(() => checkBoundary(undefined, false, "x", NOW)).not.toThrow()
    expect(() => checkBoundary({ claude: {} }, false, "x", NOW)).not.toThrow()
  })
})

describe("on a real session (C-016)", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  }, 60000)
  afterAll(() => s.stop())

  it("refuses a send to a model whose card is stale, records it without the message, and sends when it is fresh", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    const session = await s.manager.start({ cwd: s.repo })
    await expect(refuseStaleSend(session, { claude: card("2025-01-01") }, s.audit, NOW)).rejects.toBeInstanceOf(BoundaryStaleError)
    const rec = s.records().find((r) => r.event === "boundary_stale_refused" && r.session === session.id)
    expect(rec).toMatchObject({ verdict: { outcome: "deny", ruleId: "boundary-stale" } })
    expect(JSON.parse(rec!.inputJson)).toEqual({ model: expect.any(String), local: false })
    await expect(refuseStaleSend(session, { claude: card("2026-11-01") }, s.audit, NOW)).resolves.toBeUndefined()
    await session.close()
  })
})
