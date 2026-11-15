// T-049 (t3code review): @session(GT 407) in what you write is sent as the session's title and its mark, so Claude may
// read it; an unknown code, a closed session or this session itself is left as written.
import { describe, expect, it } from "vitest"
import { sessionCode } from "../src/lib/codes"
import { linkSessions, mentionOf } from "../src/lib/linkSessions"

const shop = { id: "s-shop", project: "shop", title: "Fix checkout", state: "idle" as const }
const closed = { id: "s-old", project: "docs", state: "ended" as const }
const self = { id: "s-me", project: "api", state: "running" as const }

describe("sessions as context (T-049)", () => {
  it("names a session by its code, with its title and mark", () => {
    const code = sessionCode(shop)
    expect(mentionOf(shop)).toBe(`@session(${code}) `)
    expect(linkSessions(`Do it as in @session(${code.toLowerCase()}) please`, [shop, self], self.id)).toBe(
      `Do it as in the session "Fix checkout" (${code}) [[session:s-shop]] please`,
    )
  })

  it("leaves an unknown code, a closed session and this one as written", () => {
    for (const s of [closed, self]) {
      const text = `see @session(${sessionCode(s)})`
      expect(linkSessions(text, [shop, closed, self], self.id)).toBe(text)
    }
    expect(linkSessions("see @session(ZZ 999)", [shop], self.id)).toBe("see @session(ZZ 999)")
  })
})
