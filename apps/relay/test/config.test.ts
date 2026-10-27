import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { resolveRelayConfig } from "../src/config.js"

const dirs: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gh-rcfg-"))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

describe("relay settings", () => {
  it("needs the address once, remembers it, and then needs nothing", () => {
    const data = tmp()
    expect(() => resolveRelayConfig([], { RELAY_DATA_DIR: data })).toThrow(/--public-url/)
    const first = resolveRelayConfig(["--public-url", "https://me.example.ts.net/"], {
      RELAY_DATA_DIR: data,
    })
    expect(first).toMatchObject({
      publicUrl: "https://me.example.ts.net",
      port: 8087,
      host: "127.0.0.1",
      dataDir: data,
    })
    expect(JSON.parse(fs.readFileSync(path.join(data, "relay.json"), "utf8"))).toEqual({
      publicUrl: "https://me.example.ts.net",
    })
    expect(resolveRelayConfig([], { RELAY_DATA_DIR: data }).publicUrl).toBe(
      "https://me.example.ts.net",
    )
  })

  it("refuses to change the address of a relay that already has one, because that breaks the passkeys", () => {
    const data = tmp()
    resolveRelayConfig(["--public-url", "https://a.example.test"], { RELAY_DATA_DIR: data })
    expect(() =>
      resolveRelayConfig(["--public-url", "https://b.example.test"], { RELAY_DATA_DIR: data }),
    ).toThrow(/break every paired phone/)
    expect(
      resolveRelayConfig(["--public-url", "https://a.example.test"], { RELAY_DATA_DIR: data })
        .publicUrl,
    ).toBe("https://a.example.test")
  })

  it("accepts only https, or http on localhost for testing", () => {
    for (const bad of ["http://example.com", "ftp://x", "not a url", "http://192.168.1.5"])
      expect(() => resolveRelayConfig(["--public-url", bad], { RELAY_DATA_DIR: tmp() })).toThrow(
        /https/,
      )
    expect(
      resolveRelayConfig(["--public-url", "http://localhost:8087"], { RELAY_DATA_DIR: tmp() })
        .publicUrl,
    ).toBe("http://localhost:8087")
  })

  it("puts its data under LOCALAPPDATA by default, takes the container's variables, and lets flags win", () => {
    const home = tmp()
    expect(
      resolveRelayConfig(["--public-url", "https://x.test"], { LOCALAPPDATA: home }, home).dataDir,
    ).toBe(path.join(home, "Gatehouse", "relay"))
    const c = resolveRelayConfig([], {
      RELAY_PUBLIC_URL: "https://x.test",
      RELAY_DATA_DIR: tmp(),
      RELAY_PORT: "8080",
      RELAY_HOST: "0.0.0.0",
    })
    expect(c).toMatchObject({ port: 8080, host: "0.0.0.0" })
    expect(
      resolveRelayConfig(["--port=9001", "--public-url=https://x.test"], {
        RELAY_DATA_DIR: tmp(),
        RELAY_PORT: "8080",
      }).port,
    ).toBe(9001)
  })
})
