// Mac fork (owner, 12 Nov): the phone can be told of decisions only, as ntfy is. A notification (a session finished,
// a note from Claude, the digest, an alert) then goes nowhere; requests waiting for you are sent as always.
import { GatehouseConfig as GatehouseConfigSchema } from "@gatehouse/shared/node"
import { describe, expect, it } from "vitest"
import { PhoneService, type PhoneServiceDeps } from "../src/relay/service.js"

/** A phone store that records being asked, with no Relay set up, so a notification that gets past the setting ends there. */
function service(notifyAllowed?: () => boolean) {
  const asked: string[] = []
  const store = {
    phones: () => (asked.push("phones"), []),
    relay: () => (asked.push("relay"), undefined),
  } as unknown as PhoneServiceDeps["store"]
  const svc = new PhoneService({
    store,
    broker: {} as PhoneServiceDeps["broker"],
    kill: {} as PhoneServiceDeps["kill"],
    audit: {} as PhoneServiceDeps["audit"],
    log: () => undefined,
    ...(notifyAllowed ? { notifyAllowed } : {}),
  })
  return { svc, asked }
}

describe("what the phone is told", () => {
  it("sends no notification when only decisions should reach it, reading the setting each time", async () => {
    let decisionsOnly = true
    const { svc, asked } = service(() => !decisionsOnly)
    for (const kind of ["stop", "idle", "notify", "info"] as const)
      await svc.notify(kind, { title: "Session finished", body: "", project: "atlas" })
    expect(asked).toEqual([])
    decisionsOnly = false
    await svc.notify("stop", { title: "Session finished", body: "", project: "atlas" })
    expect(asked).toContain("phones")
  })

  it("is everything when the setting is absent, as before", async () => {
    const { svc, asked } = service()
    await svc.notify("info", { title: "Codehouse digest", body: "", project: "Codehouse" })
    expect(asked).toContain("phones")
  })

  it("is a setting the file can hold, and only its two values", () => {
    expect(GatehouseConfigSchema.safeParse({ phoneAlerts: "decisions" }).success).toBe(true)
    expect(GatehouseConfigSchema.safeParse({ phoneAlerts: "all" }).success).toBe(true)
    expect(GatehouseConfigSchema.safeParse({ phoneAlerts: "some" }).success).toBe(false)
    expect(GatehouseConfigSchema.safeParse({}).success).toBe(true)
  })
})
