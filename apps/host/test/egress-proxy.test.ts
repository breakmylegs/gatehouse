// G26, the safe variant: the outgoing-connection proxy on 127.0.0.1. Off until switched on; each session has its own
// token, and a closed session's stops working; a web page (an Origin header, or a request that is not a CONNECT or a
// full URL) is refused; only the hosts allowed are reached, by the upstream proxy when one is named; each refusal is
// told to the audit; and a session started while it is on is pointed at it, with Anthropic's hosts going round it.
import http from "node:http"
import net from "node:net"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { allowed, DIRECT_HOSTS, EgressProxy, parseUpstream, type Blocked, type EgressSettings } from "../src/egress-proxy.js"
import { buildStack } from "./stack.js"

let echo: net.Server
let echoPort = 0
let web: http.Server
let webPort = 0
let seenHeaders: http.IncomingHttpHeaders = {}

beforeAll(async () => {
  echo = net.createServer((s) => s.on("data", (d) => s.write(`echo:${d.toString()}`)))
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r))
  echoPort = (echo.address() as net.AddressInfo).port
  web = http.createServer((req, res) => {
    seenHeaders = req.headers
    res.end(`hello ${req.url}`)
  })
  await new Promise<void>((r) => web.listen(0, "127.0.0.1", r))
  webPort = (web.address() as net.AddressInfo).port
})
afterAll(async () => {
  await new Promise<void>((r) => echo.close(() => r()))
  await new Promise<void>((r) => web.close(() => r()))
})

const proxies: EgressProxy[] = []
afterEach(async () => {
  for (const p of proxies.splice(0)) await p.stop()
})

function make(settings: EgressSettings | undefined) {
  const blocked: Blocked[] = []
  const s = { current: settings }
  const p = new EgressProxy({ settings: () => s.current, onBlocked: (b) => blocked.push(b) })
  proxies.push(p)
  return { p, blocked, s }
}

/** The user name and password in a proxy URL, as a Proxy-Authorization header. */
const authOf = (url: string) => {
  const u = new URL(url)
  return `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`
}

/** Sends a raw request to the proxy and gives the first line back, with the socket for what follows. */
function raw(port: number, text: string): Promise<{ line: string; all: () => string; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1")
    let buf = ""
    let done = false
    socket.on("data", (d) => {
      buf += d.toString()
      if (!done && buf.includes("\r\n")) {
        done = true
        resolve({ line: buf.split("\r\n")[0]!, all: () => buf, socket })
      }
    })
    socket.on("error", reject)
    socket.write(text)
  })
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10))
}

describe("the allow list (G26)", () => {
  it("lets through a host, its subdomains only by *., and other ports only when named", () => {
    const list = ["github.com", "*.npmjs.org", "localhost:8080", "[::1]:9000"]
    expect(allowed(list, "github.com", 443)).toBe(true)
    expect(allowed(list, "GitHub.com.", 80)).toBe(true)
    expect(allowed(list, "api.github.com", 443)).toBe(false)
    expect(allowed(list, "evilgithub.com", 443)).toBe(false)
    expect(allowed(list, "github.com", 22)).toBe(false)
    expect(allowed(list, "registry.npmjs.org", 443)).toBe(true)
    expect(allowed(list, "npmjs.org", 443)).toBe(false)
    expect(allowed(list, "localhost", 8080)).toBe(true)
    expect(allowed(list, "localhost", 443)).toBe(false)
    expect(allowed(list, "::1", 9000)).toBe(true)
    expect(allowed([], "github.com", 443)).toBe(false)
  })

  it("takes an upstream proxy as an http:// address without a user name or password", () => {
    expect(parseUpstream(undefined)).toBeUndefined()
    expect(parseUpstream("http://proxy.example:8080")).toEqual({ host: "proxy.example", port: 8080 })
    expect(parseUpstream("http://u:p@proxy.example:8080")).toMatchObject({ error: expect.stringMatching(/user name or password/) })
    expect(parseUpstream("https://proxy.example")).toMatchObject({ error: expect.any(String) })
  })
})

describe("the outgoing-connection proxy (G26)", () => {
  it("is off until switched on: no variables, nothing listening", async () => {
    const { p } = make(undefined)
    expect(await p.envFor("s1")).toBeUndefined()
    expect(p.port).toBeUndefined()
  })

  it("points a session at 127.0.0.1 with its own token, and Anthropic's hosts round it", async () => {
    const { p } = make({ egressProxy: true })
    const env = (await p.envFor("s1"))!
    const other = (await p.envFor("s2"))!
    expect(new URL(env.HTTPS_PROXY!).host).toBe(`127.0.0.1:${p.port}`)
    // It listens on this computer only (invariant 7).
    expect(p.address).toBe("127.0.0.1")
    expect(env.HTTP_PROXY).toBe(env.HTTPS_PROXY)
    expect(env.https_proxy).toBe(env.HTTPS_PROXY)
    expect(other.HTTPS_PROXY).not.toBe(env.HTTPS_PROXY)
    expect(env.NO_PROXY!.split(",")).toEqual(expect.arrayContaining([".anthropic.com", "claude.ai", "localhost"]))
    expect(DIRECT_HOSTS).toContain("anthropic.com")
  })

  it("tunnels to an allowed host only, and tells the audit which session was refused", async () => {
    const { p, blocked } = make({ egressProxy: true, allow: [`localhost:${echoPort}`] })
    const env = (await p.envFor("s1"))!
    const auth = authOf(env.HTTPS_PROXY!)
    const ok = await raw(p.port!, `CONNECT localhost:${echoPort} HTTP/1.1\r\nHost: localhost:${echoPort}\r\nProxy-Authorization: ${auth}\r\n\r\n`)
    expect(ok.line).toBe("HTTP/1.1 200 Connection established")
    ok.socket.write("ping")
    await until(() => ok.all().includes("echo:ping"))
    expect(ok.all()).toContain("echo:ping")
    ok.socket.destroy()

    const no = await raw(p.port!, `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`)
    expect(no.line).toMatch(/^HTTP\/1\.1 403/)
    no.socket.destroy()
    expect(blocked).toEqual([{ sessionId: "s1", host: "127.0.0.1", port: echoPort, reason: "not-allowed" }])
  })

  it("refuses a request without a session's token, with a wrong one, and once the session has closed", async () => {
    const { p } = make({ egressProxy: true, allow: [`localhost:${echoPort}`] })
    const env = (await p.envFor("s1"))!
    const req = (h: string) => raw(p.port!, `CONNECT localhost:${echoPort} HTTP/1.1\r\n${h}\r\n`)
    const none = await req("")
    expect(none.line).toMatch(/^HTTP\/1\.1 407/)
    expect(none.all().toLowerCase()).toContain("proxy-authenticate")
    none.socket.destroy()
    const wrong = await req(`Proxy-Authorization: Basic ${Buffer.from("codehouse:guess").toString("base64")}\r\n`)
    expect(wrong.line).toMatch(/^HTTP\/1\.1 407/)
    wrong.socket.destroy()
    p.release("s1")
    const closed = await req(`Proxy-Authorization: ${authOf(env.HTTPS_PROXY!)}\r\n`)
    expect(closed.line).toMatch(/^HTTP\/1\.1 407/)
    closed.socket.destroy()
  })

  it("refuses a web page: a request with an Origin header, and one that is not a full URL", async () => {
    const { p } = make({ egressProxy: true, allow: [`localhost:${webPort}`] })
    const auth = authOf((await p.envFor("s1"))!.HTTP_PROXY!)
    const origin = await raw(p.port!, `CONNECT localhost:${webPort} HTTP/1.1\r\nOrigin: http://evil.example\r\nProxy-Authorization: ${auth}\r\n\r\n`)
    expect(origin.line).toMatch(/^HTTP\/1\.1 403/)
    origin.socket.destroy()
    const page = await raw(p.port!, `GET / HTTP/1.1\r\nHost: rebound.example\r\nProxy-Authorization: ${auth}\r\n\r\n`)
    expect(page.line).toMatch(/^HTTP\/1\.1 400/)
    page.socket.destroy()
  })

  it("forwards a plain http:// request to an allowed host, without the proxy's token", async () => {
    const { p, blocked } = make({ egressProxy: true, allow: [`localhost:${webPort}`] })
    const auth = authOf((await p.envFor("s1"))!.HTTP_PROXY!)
    const r = await raw(p.port!, `GET http://localhost:${webPort}/x?y=1 HTTP/1.1\r\nHost: localhost:${webPort}\r\nProxy-Authorization: ${auth}\r\nConnection: close\r\n\r\n`)
    expect(r.line).toMatch(/^HTTP\/1\.1 200/)
    await until(() => r.all().includes("hello /x?y=1"))
    expect(r.all()).toContain("hello /x?y=1")
    expect(seenHeaders["proxy-authorization"]).toBeUndefined()
    r.socket.destroy()
    const no = await raw(p.port!, `GET http://127.0.0.1:${webPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${webPort}\r\nProxy-Authorization: ${auth}\r\n\r\n`)
    expect(no.line).toMatch(/^HTTP\/1\.1 403/)
    no.socket.destroy()
    expect(blocked.map((b) => b.reason)).toEqual(["not-allowed"])
  })

  it("goes by the upstream proxy when one is named, and refuses when it says no or carries a password", async () => {
    const asked: string[] = []
    let answer = "HTTP/1.1 200 OK\r\n\r\n"
    const upstream = net.createServer((s) => {
      let first = true
      s.on("data", (d) => {
        if (first) {
          first = false
          asked.push(d.toString().split("\r\n")[0]!)
          s.write(answer)
          if (!answer.includes(" 200 ")) s.end()
          return
        }
        s.write(`up:${d.toString()}`)
      })
      s.on("error", () => undefined)
    })
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r))
    const upPort = (upstream.address() as net.AddressInfo).port
    try {
      const { p, s, blocked } = make({ egressProxy: true, allow: ["github.com"], upstream: `http://127.0.0.1:${upPort}` })
      const auth = authOf((await p.envFor("s1"))!.HTTPS_PROXY!)
      const ok = await raw(p.port!, `CONNECT github.com:443 HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`)
      expect(ok.line).toBe("HTTP/1.1 200 Connection established")
      ok.socket.write("hi")
      await until(() => ok.all().includes("up:hi"))
      expect(ok.all()).toContain("up:hi")
      expect(asked).toEqual(["CONNECT github.com:443 HTTP/1.1"])
      ok.socket.destroy()

      answer = "HTTP/1.1 403 Forbidden\r\n\r\n"
      const refused = await raw(p.port!, `CONNECT github.com:443 HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`)
      expect(refused.line).toMatch(/^HTTP\/1\.1 502/)
      refused.socket.destroy()

      s.current = { egressProxy: true, allow: ["github.com"], upstream: `http://user:pw@127.0.0.1:${upPort}` }
      const creds = await raw(p.port!, `CONNECT github.com:443 HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`)
      expect(creds.line).toMatch(/^HTTP\/1\.1 403/)
      creds.socket.destroy()
      expect(asked).toHaveLength(2)
      expect(blocked.map((b) => b.reason)).toEqual(["upstream-failed", "upstream-failed"])
    } finally {
      await new Promise<void>((r) => upstream.close(() => r()))
    }
  })

  it("refuses everything once switched off, for a session started while it was on", async () => {
    const { p, s } = make({ egressProxy: true, allow: [`localhost:${echoPort}`] })
    const auth = authOf((await p.envFor("s1"))!.HTTPS_PROXY!)
    s.current = { egressProxy: false, allow: [`localhost:${echoPort}`] }
    const r = await raw(p.port!, `CONNECT localhost:${echoPort} HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`)
    expect(r.line).toMatch(/^HTTP\/1\.1 403/)
    r.socket.destroy()
  })
})

describe("a session and the proxy (G26)", () => {
  it("starts with the proxy's variables, and its token stops working when it closes", async () => {
    const proxy = new EgressProxy({ settings: () => ({ egressProxy: true, allow: [`localhost:${echoPort}`] }) })
    proxies.push(proxy)
    const s = await buildStack({ egress: proxy })
    try {
      const session = await s.manager.start({ cwd: s.repo })
      const env = s.sdk.queries.at(-1)!.options.env as Record<string, string>
      expect(new URL(env.HTTPS_PROXY!).hostname).toBe("127.0.0.1")
      expect(env.NO_PROXY).toContain(".anthropic.com")
      const auth = authOf(env.HTTPS_PROXY!)
      const open = await raw(proxy.port!, `CONNECT localhost:${echoPort} HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`)
      expect(open.line).toBe("HTTP/1.1 200 Connection established")
      open.socket.destroy()
      await session.close()
      const after = await raw(proxy.port!, `CONNECT localhost:${echoPort} HTTP/1.1\r\nProxy-Authorization: ${auth}\r\n\r\n`)
      expect(after.line).toMatch(/^HTTP\/1\.1 407/)
      after.socket.destroy()
    } finally {
      await s.stop()
    }
  })
})
