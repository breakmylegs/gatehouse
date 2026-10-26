import { describe, expect, it } from "vitest"
import {
  allowedHosts,
  assertUsableToken,
  checkRequest,
  MAX_BODY_BYTES,
  MIN_TOKEN_LENGTH,
  secretsEqual,
} from "../src/guard.js"

const token = "x".repeat(40)
const base = {
  method: "POST",
  url: "/mcp",
  headers: { host: "127.0.0.1:47821", authorization: `Bearer ${token}` },
}
const opts = { token, port: 47821 }

describe("checkRequest (invariant 7)", () => {
  it("lets a correct request through", () => {
    expect(checkRequest(base, opts)).toEqual({ ok: true })
    expect(checkRequest({ ...base, url: "/mcp?x=1" }, opts)).toEqual({ ok: true })
    expect(
      checkRequest({ ...base, headers: { ...base.headers, host: "LOCALHOST:47821" } }, opts),
    ).toEqual({ ok: true })
    expect(
      checkRequest(
        { ...base, headers: { ...base.headers, authorization: `bearer ${token}` } },
        opts,
      ),
    ).toEqual({ ok: true })
  })

  it("rejects an unexpected Host header (DNS rebinding)", () => {
    for (const host of [
      undefined,
      "",
      "evil.example",
      "evil.example:47821",
      "127.0.0.1",
      "127.0.0.1:1",
      "localhost",
      "127.0.0.1:47821.evil.example",
      "[::1]:47821",
      "0.0.0.0:47821",
    ]) {
      const headers = { ...base.headers, ...(host === undefined ? {} : { host }) }
      if (host === undefined) delete (headers as Record<string, unknown>).host
      expect(checkRequest({ ...base, headers }, opts), String(host)).toMatchObject({
        ok: false,
        status: 403,
      })
    }
  })

  it("rejects any Origin header, even a harmless looking one", () => {
    for (const origin of [
      "https://evil.example",
      "http://127.0.0.1:47821",
      "http://localhost:47821",
      "null",
      "",
    ]) {
      expect(
        checkRequest({ ...base, headers: { ...base.headers, origin } }, opts),
        origin,
      ).toMatchObject({ ok: false, status: 403 })
    }
  })

  it("rejects a missing, malformed or wrong bearer token", () => {
    const headers = (authorization?: string) => ({
      host: base.headers.host,
      ...(authorization === undefined ? {} : { authorization }),
    })
    for (const auth of [
      undefined,
      "",
      "Bearer",
      "Bearer ",
      `Basic ${token}`,
      token,
      `Bearer ${token}x`,
      `Bearer ${token.slice(1)}`,
      `Bearer ${"y".repeat(40)}`,
      `Bearer a b`,
      `Bearer ${token} extra`,
    ]) {
      expect(checkRequest({ ...base, headers: headers(auth) }, opts), String(auth)).toMatchObject({
        ok: false,
        status: 401,
      })
    }
  })

  it("rejects other methods and other paths, after authentication", () => {
    for (const method of ["GET", "DELETE", "PUT", "PATCH", "OPTIONS", "HEAD", undefined]) {
      expect(checkRequest({ ...base, method }, opts)).toMatchObject({ ok: false, status: 405 })
    }
    for (const url of ["/", "/mcp/", "/MCP", "/mcp2", "/admin", undefined]) {
      expect(checkRequest({ ...base, url }, opts), String(url)).toMatchObject({
        ok: false,
        status: 404,
      })
    }
    // Without the token a probe learns nothing about methods or paths.
    expect(
      checkRequest({ method: "GET", url: "/nope", headers: { host: base.headers.host } }, opts),
    ).toMatchObject({ status: 401 })
  })

  it("does not say which check failed", () => {
    const wrongHost = checkRequest({ ...base, headers: { ...base.headers, host: "evil" } }, opts)
    const origin = checkRequest(
      { ...base, headers: { ...base.headers, origin: "https://x" } },
      opts,
    )
    expect(wrongHost).toEqual(origin)
  })
})

describe("secrets and limits", () => {
  it("compares secrets in constant time and exactly", () => {
    expect(secretsEqual("abc", "abc")).toBe(true)
    expect(secretsEqual("abc", "abd")).toBe(false)
    expect(secretsEqual("abc", "abcd")).toBe(false)
    expect(secretsEqual("", "")).toBe(true)
  })
  it("builds the Host allowlist from the port", () => {
    expect(allowedHosts(1234)).toEqual(["127.0.0.1:1234", "localhost:1234"])
  })
  it("insists on a long token", () => {
    expect(() => assertUsableToken(undefined)).toThrow(/at least/)
    expect(() => assertUsableToken("short")).toThrow(/at least/)
    expect(assertUsableToken("z".repeat(MIN_TOKEN_LENGTH))).toHaveLength(MIN_TOKEN_LENGTH)
  })
  it("limits bodies to 256 KB", () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024)
  })
})
