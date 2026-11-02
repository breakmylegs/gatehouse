import { describe, expect, it } from "vitest"
import { redact, redactString } from "../src/redact.js"

// Fake credentials are assembled at run time so no secret-shaped literal sits in the repository.
const fake = {
  anthropic: "sk-ant-" + "a1b2c3d4".repeat(5),
  openai: "sk-" + "Z9y8x7w6".repeat(4),
  github: "ghp_" + "A1b2C3d4E5".repeat(4),
  githubPat: "github_pat_" + "A1b2C3d4E5".repeat(4),
  slack: "xoxb-" + "1234567890-abcdef",
  aws: "AKIA" + "ABCDEFGHIJKLMNOP",
  google: "AIza" + "Sy" + "A1b2C3d4E5".repeat(3),
  jwt: "eyJhbGciOi" + "." + "eyJzdWIiOiIx" + "." + "c2lnbmF0dXJl",
}

describe("redactString (invariant 12)", () => {
  it.each(Object.entries(fake))("redacts a %s token", (_name, value) => {
    const out = redactString(`token in text: ${value} and more`)
    expect(out).not.toContain(value)
    expect(out).toContain("[REDACTED:")
    expect(out).toContain("and more")
  })

  it("redacts Authorization headers, keeping the header name", () => {
    expect(redactString("curl -H 'Authorization: Bearer abc.def.ghi' x")).toBe(
      "curl -H 'Authorization: [REDACTED:authorization]' x",
    )
    expect(redactString("authorization=Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz")
  })

  it("redacts URL credentials but keeps the scheme and host", () => {
    const out = redactString("git clone https://user:hunter2@example.com/repo.git")
    expect(out).not.toContain("hunter2")
    expect(out).toContain("https://[REDACTED:url-credentials]@example.com/repo.git")
  })

  it("redacts connection strings", () => {
    const out = redactString("Server=db.internal;Database=x;User Id=sa;Password=Sup3rS3cret;")
    expect(out).not.toContain("Sup3rS3cret")
    expect(redactString("DefaultEndpointsProtocol=https;AccountName=a;AccountKey=abc123==;")).not.toContain("abc123")
  })

  it("redacts private key blocks, including unterminated ones", () => {
    const body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"
    const full = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`
    expect(redactString(full)).toBe("[REDACTED:private-key]")
    expect(redactString(`-----BEGIN RSA PRIVATE KEY-----\n${body}`)).toBe("[REDACTED:private-key]")
  })

  it("redacts key=value secrets and keeps the key name", () => {
    const out = redactString("export API_KEY=abc123 PASSWORD='p w' client_secret: zzz")
    expect(out).toContain("API_KEY=[REDACTED:secret-assignment]")
    expect(out).toContain("PASSWORD=[REDACTED:secret-assignment]")
    expect(out).toContain("client_secret: [REDACTED:secret-assignment]")
    expect(out).not.toContain("abc123")
  })

  it("redacts user terms case-insensitively and treats them as plain text", () => {
    const out = redactString("Deploy ACME-Corp and acme-corp to a.b.internal (not axb)", {
      terms: ["acme-corp", "a.b.internal", "  ", ""],
    })
    expect(out).toBe("Deploy [REDACTED:term] and [REDACTED:term] to [REDACTED:term] (not axb)")
  })

  it("leaves ordinary commands alone and is idempotent", () => {
    for (const text of ["git status && npm test", "Get-ChildItem -Recurse", "token count is 5"]) {
      expect(redactString(text)).toBe(text)
    }
    const once = redactString(`k=${fake.github}`)
    expect(redactString(once)).toBe(once)
  })
})

describe("redact (deep)", () => {
  it("redacts strings anywhere and values under secret-looking keys, without mutating", () => {
    const input = {
      command: `curl -H "Authorization: Bearer ${fake.jwt}"`,
      env: { PASSWORD: "plain", api_key: "k", max_tokens: 5, note: "ok" },
      list: [{ secret: "s" }, "client ACME"],
    }
    const copy = JSON.parse(JSON.stringify(input))
    const out = redact(input, { terms: ["ACME"] })
    expect(input).toEqual(copy)
    expect(JSON.stringify(out)).not.toContain(fake.jwt)
    expect(out.env.PASSWORD).toBe("[REDACTED:secret-key]")
    expect(out.env.api_key).toBe("[REDACTED:secret-key]")
    expect(out.env.max_tokens).toBe(5)
    expect(out.env.note).toBe("ok")
    expect(out.list[0]).toEqual({ secret: "[REDACTED:secret-key]" })
    expect(out.list[1]).toBe("client [REDACTED:term]")
  })

  it("passes through non-string primitives and survives cycles", () => {
    expect(redact(5)).toBe(5)
    expect(redact(null)).toBeNull()
    expect(redact(true)).toBe(true)
    const a: Record<string, unknown> = { name: "a" }
    a.self = a
    expect((redact(a) as Record<string, unknown>).self).toBe("[REDACTED:cycle]")
  })
})
