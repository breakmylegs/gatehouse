// Mac fork (owner, 25 Nov): what the Mac's notification of a request is told. Never the command, a path or the
// project (a notification can show on a locked screen), and Allow once only for a permission below High.
import { describe, expect, it } from "vitest"
import type { PendingView } from "../src/broker.js"
import { attentionDetail, NOTIFY_ALLOW_BELOW } from "../src/notify-mac.js"

const view = (o: { risk: number; kind?: "permission" | "question" | "plan"; defaultToNo?: boolean }): PendingView =>
  ({
    request: {
      id: "0195f0c2-7d1e-7abc-9def-0123456789ab",
      kind: o.kind ?? "permission",
      toolName: "Bash",
      input: { command: "rm -rf ~/secret-project" },
      cwd: "/Users/me/dev/secret-project",
      project: "secret-project",
      verdict: { risk: o.risk, ruleId: "r", reason: "because", outcome: "escalate" },
    },
    rawInput: { command: "rm -rf ~/secret-project" },
    defaultToNo: o.defaultToNo === true,
    phone: "none",
    hardDeadline: "",
  }) as unknown as PendingView

describe("the Mac's notification of a request", () => {
  it("is told the id, kind and risk band only", () => {
    const d = attentionDetail(view({ risk: 30 }))
    expect(d).toEqual({ id: "0195f0c2-7d1e-7abc-9def-0123456789ab", kind: "permission", band: "low", allow: true })
    expect(JSON.stringify(d)).not.toMatch(/secret|rm -rf|Users/)
  })

  it("offers Allow once only for a permission below High that is not default to no", () => {
    expect(attentionDetail(view({ risk: NOTIFY_ALLOW_BELOW - 1 }))).toMatchObject({ band: "moderate", allow: true })
    expect(attentionDetail(view({ risk: NOTIFY_ALLOW_BELOW }))).toMatchObject({ band: "high", allow: false })
    expect(attentionDetail(view({ risk: 90 }))).toMatchObject({ band: "severe", allow: false })
    expect(attentionDetail(view({ risk: 10, defaultToNo: true })).allow).toBe(false)
    expect(attentionDetail(view({ risk: 10, kind: "question" })).allow).toBe(false)
    expect(attentionDetail(view({ risk: 10, kind: "plan" })).allow).toBe(false)
  })
})
