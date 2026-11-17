// @vitest-environment jsdom
// T-045: an idle session is offered a compact before its prompt cache runs out, only when compacting is worth it, not
// while it compacts, and not once you chose Keep.
import { describe, expect, it } from "vitest"
import { COMPACT_WORTH, IDLE_OFFER_MS, shouldOfferCompact } from "../src/surfaces/Workspace"

describe("offering to compact an idle session (T-045)", () => {
  it("offers once it has sat idle long enough with a conversation worth compacting", () => {
    const base = { idleMs: IDLE_OFFER_MS, pct: COMPACT_WORTH, kept: false, pending: false }
    expect(shouldOfferCompact(base)).toBe(true)
    expect(shouldOfferCompact({ ...base, idleMs: IDLE_OFFER_MS - 1 })).toBe(false)
    expect(shouldOfferCompact({ ...base, pct: COMPACT_WORTH - 1 })).toBe(false)
    expect(shouldOfferCompact({ ...base, pct: undefined })).toBe(false)
    expect(shouldOfferCompact({ ...base, kept: true })).toBe(false)
    expect(shouldOfferCompact({ ...base, pending: true })).toBe(false)
  })
})
