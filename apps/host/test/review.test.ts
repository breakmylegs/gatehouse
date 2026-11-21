// C-043: a second model reviews a session's change through the runtime or gateway on this computer. It is offered no
// tools, sent only the redacted diff with the floor's secret files left out, and what it says becomes findings.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readFindings, reviewDiff, reviewerRuntime, sessionDiff } from "../src/review.js"
import type { LocalRuntimeConfig } from "../src/providers/local-runtime.js"

const cfg = { kind: "gateway", url: "http://127.0.0.1:4000", models: [{ name: "reviewer-1" }] } as unknown as LocalRuntimeConfig
let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  dirs = []
})

describe("the reviewer (C-043)", () => {
  it("is offered no tools and sent only the redacted diff", async () => {
    const sent: Array<Record<string, unknown>> = []
    const fetchFn = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"findings":[{"file":"src/a.ts","line":3,"severity":"high","text":"The check is inverted."}]}' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await reviewDiff({ diff: "+ const token = 'hunter2secret'\n+ if (!ok) allow()", runtime: { cfg, model: "reviewer-1" }, redact: (t) => t.replace("hunter2secret", "[redacted]"), fetchFn })
    expect(r.findings).toEqual([{ file: "src/a.ts", line: 3, severity: "high", text: "The check is inverted." }])
    expect(sent).toHaveLength(1)
    // No tools: none in the request at all, so the model can only answer in words.
    expect(sent[0]!.tools).toBeUndefined()
    expect(sent[0]!).not.toHaveProperty("tool_choice")
    expect(JSON.stringify(sent[0])).not.toContain("hunter2secret")
    expect(JSON.stringify(sent[0])).toContain("[redacted]")
  })

  it("is reached only through a runtime or gateway on this computer, with a model listed there", () => {
    expect(reviewerRuntime(cfg, "reviewer-1")).toBe(cfg)
    expect(reviewerRuntime(cfg, "other")).toBeUndefined()
    expect(reviewerRuntime({ ...cfg, url: "https://api.example.com" } as LocalRuntimeConfig, "reviewer-1")).toBeUndefined()
    expect(reviewerRuntime(undefined, "reviewer-1")).toBeUndefined()
  })

  it("reads its answer as findings, and says so when it cannot", () => {
    expect(readFindings('{"findings":[]}')).toEqual([])
    expect(readFindings('Sure! {"findings":[{"text":"Off by one","severity":"weird","line":-2}]}')).toEqual([{ severity: "medium", text: "Off by one" }])
    expect(readFindings("I think it is fine")).toEqual([{ severity: "low", text: "The reviewer's answer could not be read as findings." }])
  })

  it("never puts a secret file in the diff it sends", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gh-review-"))
    dirs.push(repo)
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" })
    git("init", "-q")
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start")
    fs.writeFileSync(path.join(repo, "app.ts"), "export const x = 1\n")
    fs.writeFileSync(path.join(repo, ".env"), "API_KEY=topsecretvalue\n")
    // Not added: a new file the session made, as most are.
    const diff = await sessionDiff(repo, ["**/.env", "**/*.pem"])
    expect(diff).toContain("export const x = 1")
    expect(diff).not.toContain("topsecretvalue")
    expect(diff).not.toContain(".env")
    // Your own index is untouched.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toMatch(/^\?\? app\.ts$/m)
  })
})
