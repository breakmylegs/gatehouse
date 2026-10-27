// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { describeEvent, pendingList, useStore } from "../src/store"

const session = {
  id: "s1",
  cwd: "C:\p",
  project: "p",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-01-01T00:00:00Z",
}
const view = (id: string, createdAt: string) => ({
  request: {
    id,
    nonce: "n",
    kind: "permission" as const,
    sessionId: "s1",
    toolUseId: "t",
    toolName: "Bash",
    input: {},
    cwd: "C:\p",
    project: "p",
    createdAt,
    expiresAt: createdAt,
    payloadHash: "h",
    verdict: {
      outcome: "escalate" as const,
      ruleId: "r",
      reason: "why",
      risk: 50,
      decidedBy: "rules" as const,
      policyHash: "h",
    },
  },
  rawInput: {},
  defaultToNo: false,
  phone: "none" as const,
  hardDeadline: createdAt,
})
const resolution = (summary: string) => ({
  outcome: "allow" as const,
  channel: "desktop" as const,
  at: "2026-01-01T00:01:00Z",
  waitedMs: 5,
  summary,
})

beforeEach(() => {
  useStore.setState({
    sessions: {},
    pending: {},
    resolved: {},
    transcripts: {},
    audit: [],
    selectedRequest: undefined,
  })
})

describe("store events", () => {
  it("queues requests oldest first and selects the first without moving an existing choice", () => {
    const h = useStore.getState().handleEvent
    h({ type: "approval_request", view: view("b", "2026-01-01T00:00:02Z") })
    h({ type: "approval_request", view: view("a", "2026-01-01T00:00:01Z") })
    expect(pendingList(useStore.getState()).map((p) => p.request.id)).toEqual(["a", "b"])
    expect(useStore.getState().selectedRequest).toBe("b")
  })

  it("keeps a resolved request visible with its summary and moves selection to the next waiting one", () => {
    const h = useStore.getState().handleEvent
    h({ type: "approval_request", view: view("a", "2026-01-01T00:00:01Z") })
    h({ type: "approval_request", view: view("b", "2026-01-01T00:00:02Z") })
    useStore.getState().selectRequest("a")
    h({
      type: "approval_resolved",
      id: "a",
      sessionId: "s1",
      resolution: resolution("Approved on iPhone at 14:02"),
    })
    const s = useStore.getState()
    expect(s.pending.a).toBeUndefined()
    expect(s.resolved.a?.summary).toBe("Approved on iPhone at 14:02")
    expect(s.resolved.a?.view?.request.id).toBe("a")
    expect(s.selectedRequest).toBe("b")
  })

  it("updates the phone status of a waiting request and ignores one that has gone", () => {
    const h = useStore.getState().handleEvent
    h({ type: "approval_request", view: view("a", "2026-01-01T00:00:01Z") })
    h({ type: "phone_status", id: "a", status: "delivered" })
    h({ type: "phone_status", id: "gone", status: "expired" })
    expect(useStore.getState().pending.a?.phone).toBe("delivered")
    expect(useStore.getState().pending.gone).toBeUndefined()
  })

  it("replaces everything on hello, keeping the selection only if it is still waiting", () => {
    const h = useStore.getState().handleEvent
    useStore.setState({ selectedRequest: "old" })
    h({
      type: "hello",
      sessions: [session],
      pending: [view("a", "2026-01-01T00:00:01Z")],
      usage: {},
      health: undefined as never,
    })
    expect(Object.keys(useStore.getState().sessions)).toEqual(["s1"])
    expect(useStore.getState().selectedRequest).toBe("a")
  })

  it("caps the live audit tail and the resolved list", () => {
    const h = useStore.getState().handleEvent
    for (let i = 0; i < 520; i++) h({ type: "audit", record: { seq: i } })
    expect(useStore.getState().audit.length).toBe(500)
    expect((useStore.getState().audit[0] as { seq: number }).seq).toBe(519)
    for (let i = 0; i < 120; i++)
      h({ type: "approval_resolved", id: `r${i}`, sessionId: "s1", resolution: resolution("x") })
    expect(Object.keys(useStore.getState().resolved).length).toBe(100)
  })

  it("builds a transcript from sdk messages and describes only meaningful session events", () => {
    const h = useStore.getState().handleEvent
    h({
      type: "sdk_message",
      sessionId: "s1",
      message: { type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } },
    })
    h({ type: "session_event", sessionId: "s1", event: "stop", data: {} })
    h({
      type: "session_event",
      sessionId: "s1",
      event: "subagent_start",
      data: { agent_type: "Explore" },
    })
    expect(useStore.getState().transcripts.s1?.items.map((i) => i.kind)).toEqual(["text", "system"])
    expect(describeEvent("notification", { message: "Needs input" })).toBe("Needs input")
    expect(describeEvent("stop", {})).toBeUndefined()
    expect(describeEvent("subagent_stop", {})).toBe("Subagent finished")
  })
})
