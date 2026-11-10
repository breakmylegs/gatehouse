// Browser tools (owner's Settings overhaul, 6 Nov): a coding session looks at a page on this computer, and only there.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { checkPageUrl, edgeLookArgs, lookAtPage, pageText } from "../src/page-look.js"
import { createCompanionSdkServer } from "../src/companion-server.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-look-test-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("looking at a page", () => {
  it("takes only pages on this computer, with no name or password in the address", () => {
    expect(checkPageUrl(" http://localhost:5173/app ")).toBe("http://localhost:5173/app")
    expect(checkPageUrl("https://127.0.0.1:8443/")).toBe("https://127.0.0.1:8443/")
    for (const bad of [
      "https://claude.ai/",
      "http://localhost.example.com/",
      "http://127.0.0.2/",
      "http://user:pw@localhost/",
      "file:///C:/Windows/win.ini",
      "javascript:alert(1)",
      "localhost:5173",
    ])
      expect(() => checkPageUrl(bad), bad).toThrow(/Only pages on this computer|not a web address/)
  })

  it("gives Edge its own profile for the look and no debugging, automation or extension switch", () => {
    const args = edgeLookArgs("C:/t/a", { shot: "C:/t/p.png" }, "http://localhost/")
    expect(args).toContain("--user-data-dir=C:/t/a")
    expect(args).toContain("--screenshot=C:/t/p.png")
    expect(args.at(-1)).toBe("http://localhost/")
    for (const a of [...args, ...edgeLookArgs("C:/t/b", "dom", "http://localhost/")])
      expect(a).not.toMatch(/remote-debugging|load-extension|enable-automation|profile-directory/)
  })

  it("reads a page's words without its scripts or tags", () => {
    expect(
      pageText(
        "<html><head><style>p{}</style><script>var secret=1</script></head><body><h1>Shop</h1><p>Total &amp; tax</p><!-- note --></body></html>",
      ),
    ).toBe("Shop\nTotal & tax")
    expect(pageText("x".repeat(30), 10)).toBe("xxxxxxxxxx\n[the rest was left out]")
  })

  it("gives Claude the picture and the redacted text, refuses an outside address before Edge runs, and leaves no profile", async () => {
    const calls: string[][] = []
    const deps = {
      tmpDir: dir,
      edge: async () => "C:/Edge/msedge.exe",
      redact: (t: string) => t.replace(/Falcon/g, "[redacted]"),
      run: async (_exe: string, args: string[]) => {
        calls.push(args)
        const shot = args.find((a) => a.startsWith("--screenshot="))
        if (shot) fs.writeFileSync(shot.slice("--screenshot=".length), Buffer.from([1, 2, 3]))
        return args.includes("--dump-dom") ? "<p>Project Falcon</p>" : ""
      },
    }
    const out = await lookAtPage("http://localhost:3000/", deps)
    expect(out.image).toBe(Buffer.from([1, 2, 3]).toString("base64"))
    expect(out.text).toContain("Project [redacted]")
    expect(calls).toHaveLength(2)
    expect(fs.readdirSync(dir)).toEqual([])
    const refused = await lookAtPage("https://example.com/", deps)
    expect(refused).toMatchObject({ isError: true })
    expect(calls).toHaveLength(2)
    // No picture (no server there): says so, and still leaves nothing behind.
    const none = await lookAtPage("http://localhost:1/", { ...deps, run: async () => "" })
    expect(none).toMatchObject({ isError: true, text: expect.stringMatching(/no picture/) })
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("is offered to a session only when it has a page client", () => {
    const base = {
      sessionId: "s",
      cwd: dir,
      host: { notify: async () => true },
      policy: () => undefined,
      redact: <T>(v: T) => v,
    }
    const names = (s: ReturnType<typeof createCompanionSdkServer>) =>
      Object.keys(
        (s.instance as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
      )
    expect(names(createCompanionSdkServer(base))).not.toContain("look_at_page")
    expect(
      names(createCompanionSdkServer({ ...base, pages: { look: async () => ({ text: "" }) } })),
    ).toContain("look_at_page")
  })
})
