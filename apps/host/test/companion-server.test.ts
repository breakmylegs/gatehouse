import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { loadPolicy, redact } from "@gatehouse/policy"
import { createCompanionSdkServer } from "../src/companion-server.js"
import { SEED_RULES } from "../../../packages/policy/test/helpers.js"

let root: string
let repo: string
let client: Client
const sent: { sessionId: string; text: string }[] = []
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim()

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-companion-sdk-"))
  repo = path.join(root, "proj")
  fs.mkdirSync(repo)
  git(repo, "init", "-q")
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n")
  git(repo, "add", ".")
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
  const policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: ["C:/dev"] })
  const server = createCompanionSdkServer({
    sessionId: "sdk-sess",
    cwd: repo,
    host: { notify: async (m) => (sent.push(m), true) },
    policy: () => policy,
    redact: (v) => redact(v, { terms: ["AcmeCorp"] }),
  })
  expect(server.type).toBe("sdk")
  expect(server.name).toBe("companion")
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.instance.connect(a)
  client = new Client({ name: "t", version: "0.0.0" })
  await client.connect(b)
})
afterAll(async () => {
  await client.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe("the Companion as an in-process SDK server", () => {
  it("has the same three tools, so the names stay mcp__companion__*", async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["create_checkpoint", "get_policy_summary", "notify_user"])
  })

  it("runs the shared handlers", async () => {
    const text = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args })
      return { text: (r.content as { text: string }[])[0]?.text ?? "", isError: r.isError === true }
    }
    expect(await text("notify_user", { text: "AcmeCorp done" })).toEqual({ text: "Sent.", isError: false })
    expect(sent).toEqual([{ sessionId: "sdk-sess", text: "[REDACTED:term] done" }])
    const cp = await text("create_checkpoint", { label: "x" })
    expect(cp.isError).toBe(false)
    expect(cp.text).toContain("refs/gatehouse/checkpoints/sdk-sess/")
    expect((await text("get_policy_summary")).text).toContain("These run without asking")
    expect((await text("notify_user", { text: "again" })).text).toContain("only one notification a minute")
  })
})
