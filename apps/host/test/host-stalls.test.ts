// T-132: Doctor says when the Host stopped answering or a request was slow, by the route's pattern only, and not
// for the computer sleeping or a request that waits on purpose.
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { registerDoctorRoutes } from "../src/doctor.js"
import { HostStalls, TICK_MS } from "../src/host-stalls.js"

describe("stalls and slow requests (T-132)", () => {
  it("notes a late timer as a stall, but not the computer asleep, and says so in Doctor for an hour", () => {
    let now = Date.parse("2026-11-19T10:00:00Z")
    const s = new HostStalls(() => now)
    s.start()
    s.stop()
    now += TICK_MS
    s.tick()
    expect(s.check()).toMatchObject({ id: "responsiveness", state: "ok" })
    now += TICK_MS + 3200
    s.tick()
    now += TICK_MS + 600_000
    s.tick()
    expect(s.stalls.map((x) => x.ms)).toEqual([3200])
    const c = s.check()
    expect(c.state).toBe("warn")
    expect(c.detail).toMatch(/stopped answering once in the last hour, the longest for 3\.2 s/)
    now += 3_600_000
    expect(s.check().state).toBe("ok")
  })

  it("counts slow requests by route, not those that wait on purpose", () => {
    const s = new HostStalls(() => 0)
    s.request("GET", "/api/doctor", 4999)
    s.request("POST", "/cli/sessions/:id/send", 60_000)
    s.request("GET", "/ws", 600_000)
    s.request("GET", "/api/sessions/:id", 7100)
    s.request("GET", "/api/x", 9000)
    expect(s.slow.map((x) => x.route)).toEqual(["GET /api/sessions/:id", "GET /api/x"])
    expect(s.check().detail).toMatch(/2 requests were slow, the longest GET \/api\/x at 9\.0 s\./)
  })

  it("is told each request by its pattern, never its address", async () => {
    const seen: unknown[][] = []
    const stalls = Object.assign(new HostStalls(), { request: (...a: unknown[]) => void seen.push(a) })
    const app = Fastify()
    registerDoctorRoutes(app, { config: () => ({}) as never, env: {}, stalls })
    app.get("/api/thing/:id", async () => ({ ok: true }))
    try {
      await app.inject({ method: "GET", url: "/api/thing/C%3A%5Cdev%5Csecret?token=abc" })
      expect(seen).toHaveLength(1)
      expect(seen[0]!.slice(0, 2)).toEqual(["GET", "/api/thing/:id"])
      expect(typeof seen[0]![2]).toBe("number")
    } finally {
      await app.close()
    }
  })
})
