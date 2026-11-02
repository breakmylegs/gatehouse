// Artifacts (owner's plan, W1-09, ADR 0003): kept as versions, redacted, audited, and served only in a sandbox.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chatArtifactClient } from "../src/artifact-client.js"
import {
  ArtifactError,
  artifactHeaders,
  ArtifactStore,
  MAX_ARTIFACT_BYTES,
  MAX_VERSIONS,
} from "../src/artifacts.js"
import { createCompanionSdkServer } from "../src/companion-server.js"
import { buildStack, type Stack } from "./stack.js"
import type { HostAudit } from "../src/hostaudit.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-artifacts-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
let n = 0
const SESSION = "019a0000-0000-7000-8000-000000000001"
const fresh = (redact?: (t: string) => string) =>
  new ArtifactStore(path.join(dir, `a-${++n}`), redact)
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch (e) {
    return e instanceof ArtifactError ? e.code : "other"
  }
  return "none"
}

describe("keeping artifacts", () => {
  it("keeps a page and a picture, and a second save under the same title is the next version", async () => {
    const s = fresh()
    const a = await s.save(SESSION, "Budget chart", "html", "<h1>one</h1>")
    expect(a).toMatchObject({ id: "budget-chart", title: "Budget chart", kind: "html" })
    expect(a.version).toMatchObject({ version: 1, bytes: 12 })
    const b = await s.save(SESSION, "Budget  Chart", "html", "<h1>two</h1>")
    expect(b.version.version).toBe(2)
    await s.save(SESSION, "Logo", "svg", "<svg xmlns='http://www.w3.org/2000/svg'/>")
    expect(s.list(SESSION).map((x) => [x.id, x.kind, x.versions.length])).toEqual([
      ["budget-chart", "html", 2],
      ["logo", "svg", 1],
    ])
    expect(s.read(SESSION, "budget-chart", 1)?.content).toBe("<h1>one</h1>")
    expect(s.read(SESSION, "budget-chart", 2)?.content).toBe("<h1>two</h1>")
    expect(s.read(SESSION, "budget-chart", 3)).toBeUndefined()
    expect(s.read(SESSION, "nope", 1)).toBeUndefined()
  })

  it("redacts before it writes, so a secret never reaches the file", async () => {
    const s = fresh((t) => t.replaceAll("AcmeCorp", "[redacted]"))
    await s.save(SESSION, "Page", "html", "<p>AcmeCorp internal</p>")
    expect(s.read(SESSION, "page", 1)?.content).toBe("<p>[redacted] internal</p>")
    const files = fs.readdirSync(path.join(dir, `a-${n}`, SESSION, "page"))
    expect(
      fs.readFileSync(path.join(dir, `a-${n}`, SESSION, "page", files[0]!), "utf8"),
    ).not.toContain("AcmeCorp")
  })

  it("refuses what it should and writes nothing", async () => {
    const s = fresh()
    expect(await code(() => s.save(SESSION, "x", "javascript", "alert(1)"))).toBe("invalid")
    expect(await code(() => s.save(SESSION, "", "html", "<p>x</p>"))).toBe("invalid")
    expect(await code(() => s.save(SESSION, "!!!", "html", "<p>x</p>"))).toBe("invalid")
    expect(await code(() => s.save(SESSION, "t", "html", "   "))).toBe("invalid")
    expect(await code(() => s.save(SESSION, "t", "html", "x".repeat(MAX_ARTIFACT_BYTES + 1)))).toBe(
      "too-big",
    )
    expect(await code(() => s.save("../escape", "t", "html", "<p>x</p>"))).toBe("invalid")
    expect(await code(() => s.save("not-a-session", "t", "html", "<p>x</p>"))).toBe("invalid")
    expect(s.list(SESSION)).toEqual([])
    // The same title is the same artifact, so it cannot change kind.
    await s.save(SESSION, "Same", "html", "<p>x</p>")
    expect(await code(() => s.save(SESSION, "Same", "svg", "<svg/>"))).toBe("invalid")
    // Reading is as careful as writing: a session id that is not one never reaches the disk.
    expect(await code(async () => s.read("../escape", "x", 1))).toBe("invalid")
  })

  it("keeps at most the allowed versions, and can take one back out", async () => {
    const s = fresh()
    for (let i = 0; i < MAX_VERSIONS; i++) await s.save(SESSION, "Busy", "html", `<p>${i}</p>`)
    expect(await code(() => s.save(SESSION, "Busy", "html", "<p>more</p>"))).toBe("full")
    await s.discard(SESSION, "busy", MAX_VERSIONS)
    expect(s.read(SESSION, "busy", MAX_VERSIONS)).toBeUndefined()
    expect(s.list(SESSION)[0]!.versions).toHaveLength(MAX_VERSIONS - 1)
    // Taking back the only version of an artifact takes the artifact with it.
    await s.save(SESSION, "Once", "html", "<p>x</p>")
    await s.discard(SESSION, "once", 1)
    expect(s.list(SESSION).some((a) => a.id === "once")).toBe(false)
  })

  it("reads a damaged index as empty", () => {
    const s = fresh()
    fs.mkdirSync(path.join(dir, `a-${n}`, SESSION), { recursive: true })
    fs.writeFileSync(path.join(dir, `a-${n}`, SESSION, "index.json"), "{ not json")
    expect(s.list(SESSION)).toEqual([])
  })
})

describe("how an artifact is served", () => {
  const h = artifactHeaders("http://127.0.0.1:5173", "html")

  it("is a sandbox with scripts of its own and nothing else", () => {
    const csp = h["content-security-policy"]!
    expect(csp).toContain("sandbox allow-scripts;")
    // No same origin, forms, pop-ups, top navigation or downloads.
    expect(csp).not.toMatch(/allow-(same-origin|forms|popups|top-navigation|modals|downloads)/)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("frame-ancestors http://127.0.0.1:5173")
    // It may not load anything from the Host, from the internet, or from itself.
    expect(csp).not.toMatch(/'self'|https?:\/\/(?!127)/)
    expect(csp).toContain("img-src data: blob:")
  })

  it("is not sniffed, cached or given a referrer, and has the right type for each kind", () => {
    expect(h["x-content-type-options"]).toBe("nosniff")
    expect(h["cache-control"]).toBe("no-store")
    expect(h["referrer-policy"]).toBe("no-referrer")
    expect(h["content-type"]).toContain("text/html")
    expect(artifactHeaders("http://x", "svg")["content-type"]).toContain("image/svg+xml")
  })
})

function fakeAudit() {
  const records: Array<{ event: string; input?: unknown }> = []
  const audit = {
    fail: false,
    async record(r: { event: string; input?: unknown }) {
      if (audit.fail) return false
      records.push(r)
      return true
    },
  }
  return { audit: audit as unknown as HostAudit & { fail: boolean }, records }
}

describe("what a chat may do with artifacts", () => {
  const setup = () => {
    const store = fresh()
    const { audit, records } = fakeAudit()
    const client = chatArtifactClient({
      store,
      audit,
      sessionId: SESSION,
      cwd: "C:/chat",
      policyHash: () => "h",
    })
    return { store, audit, records, client }
  }

  it("saves, tells Claude what happened, and records the version by id, kind and size, never the content", async () => {
    const { client, records } = setup()
    const r = await client.save("Chart", "html", "<p>the secret figure is 41</p>")
    expect(r.isError).toBeUndefined()
    expect(r.text).toContain('Saved "Chart", version 1')
    expect(records).toHaveLength(1)
    expect(records[0]!.event).toBe("artifact_saved")
    expect(records[0]!.input).toMatchObject({ id: "chart", version: 1, kind: "html" })
    expect(JSON.stringify(records[0])).not.toContain("41")
  })

  it("takes the version back out and refuses when it cannot be recorded", async () => {
    const { client, audit, store } = setup()
    audit.fail = true
    const r = await client.save("Chart", "html", "<p>x</p>")
    expect(r).toMatchObject({ isError: true, text: expect.stringMatching(/could not be recorded/) })
    expect(store.list(SESSION)).toEqual([])
  })

  it("says why in words when the store refuses", async () => {
    const { client } = setup()
    expect((await client.save("Chart", "exe", "x")).text).toMatch(/html or svg/)
    expect((await client.save("Big", "html", "x".repeat(MAX_ARTIFACT_BYTES + 1))).isError).toBe(
      true,
    )
  })
})

describe("the tool in the Companion", () => {
  it("is offered to a session that has artifacts, and only then", async () => {
    const { client } = (() => {
      const store = fresh()
      const { audit } = fakeAudit()
      return {
        client: chatArtifactClient({
          store,
          audit,
          sessionId: SESSION,
          cwd: "C:/c",
          policyHash: () => "h",
        }),
      }
    })()
    const names = async (artifacts?: typeof client) => {
      const server = createCompanionSdkServer({
        sessionId: "s",
        cwd: dir,
        host: { notify: async () => true },
        policy: () => undefined,
        redact: (v) => v,
        ...(artifacts ? { artifacts } : {}),
      })
      const [a, b] = InMemoryTransport.createLinkedPair()
      await server.instance.connect(a)
      const c = new Client({ name: "t", version: "0.0.0" })
      await c.connect(b)
      const out = (await c.listTools()).tools.map((t) => t.name).sort()
      await c.close()
      return out
    }
    expect(await names()).not.toContain("save_artifact")
    expect(await names(client)).toContain("save_artifact")
  })
})

describe("a chat is told about artifacts", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
    s.deps.artifacts = new ArtifactStore(path.join(s.dir, "artifacts"))
    s.deps.chatsDir = path.join(s.dir, "chats")
  }, 60000)
  afterAll(() => s.stop())

  it("in a chat, and not in a coding session", async () => {
    await s.manager.start({ cwd: "x", kind: "chat", title: "hello" })
    const chat = s.sdk.queries.at(-1)?.options.systemPrompt as string
    expect(chat).toContain("save_artifact")
    expect(chat).toContain("sandbox")
    await s.manager.start({ cwd: s.repo })
    const code = s.sdk.queries.at(-1)?.options.systemPrompt as { append?: string }
    expect(code.append ?? "").not.toContain("save_artifact")
  })
})
