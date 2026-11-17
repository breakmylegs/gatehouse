// Native addresses for CNW: CNW_HOST alone chooses the certificate (an IP or a home-network name: caddy's own
// authority; a public name: Let's Encrypt), CNW_TLS overrides it, CNW_PORT goes into the public address, and an IP
// gets default_sni so the handshake works with no server name. A host that is neither name nor address is refused.
import { describe, expect, it } from "vitest"
import { caddyfile, hostKind, publicUrlOf, tlsMode } from "../src/tls.js"

describe("the certificate CNW_HOST chooses", () => {
  it("is caddy's own authority for an IPv4 or IPv6 address, home network or internet", () => {
    for (const host of ["192.168.1.225", "10.0.0.4", "203.0.113.9", "2001:db8::25", "[fd00::1]"]) {
      expect(hostKind(host), host).toBe("ip")
      expect(tlsMode(host), host).toBe("internal")
    }
  })

  it("is caddy's own authority for a home-network name, and Let's Encrypt for a public one", () => {
    for (const host of ["cnw.home.arpa", "cnw.lan", "watch.internal", "box.local", "cnw", "CNW.HOME.ARPA."]) {
      expect(hostKind(host), host).toBe("local")
      expect(tlsMode(host), host).toBe("internal")
    }
    for (const host of ["cnw.example.org", "watch.breakmylegs.dev"]) expect(tlsMode(host), host).toBe("public")
  })

  it("follows CNW_TLS when it is set, and refuses any other value", () => {
    expect(tlsMode("cnw.example.org", "internal")).toBe("internal")
    expect(tlsMode("cnw.home.arpa", "PUBLIC")).toBe("public")
    expect(() => tlsMode("cnw.home.arpa", "letsencrypt")).toThrow(/internal or public/)
  })

  it("puts CNW_PORT in the public address, and none for 443", () => {
    expect(publicUrlOf("192.168.1.225")).toBe("https://192.168.1.225")
    expect(publicUrlOf("192.168.1.225", "8443")).toBe("https://192.168.1.225:8443")
    expect(publicUrlOf("2001:db8::25", "443")).toBe("https://[2001:db8::25]")
    expect(() => publicUrlOf("cnw.lan", "99999")).toThrow(/port number/)
  })
})

describe("caddy's configuration", () => {
  it("for an IP: tls internal and default_sni, the address bracketed for IPv6", () => {
    const ip = caddyfile({ host: "192.168.1.225" })
    expect(ip).toContain("\tdefault_sni 192.168.1.225")
    expect(ip).toMatch(/^192\.168\.1\.225 \{\n\ttls internal$/m)
    expect(caddyfile({ host: "2001:db8::25" })).toMatch(/^\[2001:db8::25\] \{\n\ttls internal$/m)
  })

  it("for a home name: tls internal without default_sni; for a public name: neither (Let's Encrypt)", () => {
    const local = caddyfile({ host: "cnw.home.arpa" })
    expect(local).toContain("cnw.home.arpa {\n\ttls internal")
    expect(local).not.toContain("default_sni")
    const pub = caddyfile({ host: "cnw.example.org" })
    expect(pub).not.toContain("tls internal")
    expect(pub).toContain("reverse_proxy 172.30.0.20:8080")
  })

  it("turns caddy's redirect from http off on another port, where it would send people to 443", () => {
    expect(caddyfile({ host: "192.168.1.225", port: "8443" })).toContain("auto_https disable_redirects")
    expect(caddyfile({ host: "192.168.1.225" })).not.toContain("auto_https")
  })

  it("refuses a CNW_HOST that is neither a name nor an address, so nothing can be written around it", () => {
    for (const host of ["", "cnw.lan {\n\tredir https://evil", "a b", "https://cnw.lan", "cnw.lan:443"]) expect(() => caddyfile({ host }), host).toThrow()
  })
})
