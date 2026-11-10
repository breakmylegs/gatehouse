// D-021, the rubber-stamp detector: approvals too fast to read, or from rows never opened, slow the next High one.
import { describe, expect, it } from "vitest"
import { RubberStamp } from "../src/rubber-stamp.js"

describe("the rubber-stamp detector (D-021)", () => {
  it("arms after three fast High approvals in a row, and not after slow or Moderate ones", () => {
    const r = new RubberStamp()
    expect(r.approved({ risk: 80, shownMs: 300 })).toBe(false)
    expect(r.approved({ risk: 90, shownMs: 500 })).toBe(false)
    expect(r.approved({ risk: 70, shownMs: 799 })).toBe(true)
    expect(r.needsDeliberate(80)).toBe(true)
    expect(r.needsDeliberate(50)).toBe(false)
    const slow = new RubberStamp()
    slow.approved({ risk: 80, shownMs: 300 })
    slow.approved({ risk: 80, shownMs: 3000 })
    slow.approved({ risk: 80, shownMs: 300 })
    slow.approved({ risk: 40, shownMs: 100 })
    expect(slow.armed).toBe(false)
  })

  it("arms after ten approvals in a row from rows never opened", () => {
    const r = new RubberStamp()
    for (let i = 0; i < 9; i++) r.approved({ risk: 30, opened: false })
    expect(r.armed).toBe(false)
    r.approved({ risk: 30, opened: false })
    expect(r.armed).toBe(true)
  })

  it("is reset by a deny or a deliberate approval, and a deny never needs one", () => {
    const r = new RubberStamp()
    r.approved({ risk: 80, shownMs: 100 })
    r.approved({ risk: 80, shownMs: 100 })
    r.denied()
    r.approved({ risk: 80, shownMs: 100 })
    expect(r.armed).toBe(false)
    r.approved({ risk: 80, shownMs: 100 })
    r.approved({ risk: 80, shownMs: 100 })
    expect(r.armed).toBe(true)
    r.deliberate()
    expect(r.armed).toBe(false)
  })
})
