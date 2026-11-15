// T-061 (t3code review): read-only GitHub through gh. Off until switched on; only a number reaches gh's arguments;
// each read is recorded; what comes back is cleaned, and an address that is not GitHub's is dropped.
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { ForgeError, listPullRequests, viewPullRequest } from "../src/forge/github.js"
import { registerForgeRoutes } from "../src/forge/routes.js"

const calls: string[][] = []
const fake = async (_cwd: string, args: string[]) => {
  calls.push(args)
  if (args[1] === "list")
    return JSON.stringify([
      { number: 12, title: "Fix the cache", state: "OPEN", url: "https://github.com/acme/shop/pull/12", headRefName: "fix/cache", isDraft: false },
      { number: 0, title: "bad" },
      { number: 13, title: "x", state: "OPEN", url: "javascript:alert(1)", headRefName: "y", isDraft: true },
    ])
  return JSON.stringify({
    number: 12,
    title: "Fix the cache",
    state: "OPEN",
    url: "https://github.com/acme/shop/pull/12",
    headRefName: "fix/cache",
    baseRefName: "main",
    reviewDecision: "APPROVED",
    statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }, { context: "lint", state: "FAILURE" }],
  })
}

describe("read-only GitHub (T-061)", () => {
  it("lists and reads pull requests with fixed arguments, dropping what is not GitHub", async () => {
    const list = await listPullRequests("C:/repo", fake)
    expect(list.map((p) => [p.number, p.url])).toEqual([
      [12, "https://github.com/acme/shop/pull/12"],
      [13, ""],
    ])
    const pr = await viewPullRequest("C:/repo", 12, fake)
    expect(pr).toMatchObject({ base: "main", review: "APPROVED", checks: [{ name: "build", state: "SUCCESS" }, { name: "lint", state: "FAILURE" }] })
    expect(calls.at(-1)?.slice(0, 3)).toEqual(["pr", "view", "12"])
    for (const bad of ["12; rm", -1, 1.5, "--repo=x"]) await expect(viewPullRequest("C:/repo", bad, fake)).rejects.toThrow(ForgeError)
  })

  it("reads nothing while switched off, and records each read", async () => {
    let on = false
    const records: unknown[] = []
    const app = Fastify()
    registerForgeRoutes(app, {
      enabled: () => on,
      sessionCwd: (id) => (id === "s1" ? "C:/repo" : undefined),
      audit: { record: async (r: unknown) => (records.push(r), true) },
      gh: fake,
    })
    const before = calls.length
    expect((await app.inject({ method: "GET", url: "/api/forge/prs?session=s1" })).statusCode).toBe(403)
    expect(calls.length).toBe(before)
    on = true
    expect((await app.inject({ method: "GET", url: "/api/forge/prs?session=s1" })).json().prs).toHaveLength(2)
    expect((await app.inject({ method: "GET", url: "/api/forge/pr?session=s1&number=12" })).json().pr.number).toBe(12)
    expect((await app.inject({ method: "GET", url: "/api/forge/pr?session=zz&number=12" })).statusCode).toBe(404)
    expect(records).toHaveLength(2)
    await app.close()
  })
})
