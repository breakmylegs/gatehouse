// T-073 (t3code review): /clone and /publish make a request for you to send, never a clone or a push by themselves;
// /clone takes only a plain https or ssh address.
import { describe, expect, it } from "vitest"
import { cloneRequest, PUBLISH_REQUEST } from "../src/lib/repoRequests"

describe("clone and publish as requests (T-073)", () => {
  it("accepts a plain repository address and nothing that could carry a command", () => {
    expect(cloneRequest("https://github.com/acme/shop.git")).toContain("git clone")
    expect(cloneRequest("git@github.com:acme/shop.git")).toContain("git@github.com:acme/shop.git")
    for (const bad of ["https://x.com/a b", "https://x.com/a;rm -rf /", "file:///C:/secret", "https://x.com/$(whoami)", "--upload-pack=x", ""])
      expect(cloneRequest(bad), bad).toBeUndefined()
  })

  it("publishes privately, through gh, and never public", () => {
    expect(PUBLISH_REQUEST).toContain("private repository with gh repo create")
    expect(PUBLISH_REQUEST).toContain("Do not make it public")
  })
})
