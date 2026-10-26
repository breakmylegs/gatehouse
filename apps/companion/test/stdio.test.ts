import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SEED_RULES } from "../../../packages/policy/test/helpers.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const MAIN = path.resolve(here, "../src/main.ts")
// The child runs in a temp project folder, so the TypeScript loader must be given by absolute URL.
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href

let root: string
let repo: string
let host: http.Server
let hostPort: number
const posts: { auth: string | undefined; body: { sessionId: string; text: string } }[] = []
let client: Client

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
const callText = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args })
  return { text: (r.content as { text: string }[])[0]?.text ?? "", isError: r.isError === true }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-companion-stdio-"))
  repo = path.join(root, "proj")
  fs.mkdirSync(repo)
  git(repo, "init", "-q")
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n")
  git(repo, "add", ".")
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
  fs.writeFileSync(path.join(repo, ".env"), "SECRET=1\n")

  const dataDir = path.join(root, "data")
  fs.mkdirSync(dataDir)
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ redactTerms: ["AcmeCorp"] }))
  const rules = path.join(root, "rules.yaml")
  fs.copyFileSync(SEED_RULES, rules)

  host = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      posts.push({ auth: req.headers.authorization, body: JSON.parse(body) })
      res.writeHead(200).end("{}")
    })
  })
  await new Promise<void>((r) => host.listen(0, "127.0.0.1", () => r()))
  hostPort = (host.address() as { port: number }).port

  client = new Client({ name: "companion-test", version: "0.0.0" })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", TSX, MAIN],
      cwd: repo,
      env: {
        ...(process.env as Record<string, string>),
        GATEHOUSE_SESSION_ID: "stdio-sess",
        GATEHOUSE_DATA_DIR: dataDir,
        GATEHOUSE_RULES_PATH: rules,
        GATEHOUSE_HOST_URL: `http://127.0.0.1:${hostPort}`,
        GATEHOUSE_HOST_TOKEN: "host-token-for-test",
      },
    }),
  )
}, 60000)

afterAll(async () => {
  await client.close()
  await new Promise<void>((r) => host.close(() => r()))
  fs.rmSync(root, { recursive: true, force: true })
})

describe("the Companion over stdio", () => {
  it("offers exactly the three agent-facing tools", async () => {
    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "create_checkpoint",
      "get_policy_summary",
      "notify_user",
    ])
  })

  it("notify_user posts a redacted message to the Host with the bearer token", async () => {
    const r = await callText("notify_user", { text: "AcmeCorp tests pass" })
    expect(r).toEqual({ text: "Sent.", isError: false })
    expect(posts).toHaveLength(1)
    expect(posts[0]?.auth).toBe("Bearer host-token-for-test")
    expect(posts[0]?.body).toEqual({ sessionId: "stdio-sess", text: "[REDACTED:term] tests pass" })
  })

  it("notify_user refuses a second message inside a minute and an oversized one", async () => {
    expect((await callText("notify_user", { text: "again" })).text).toContain(
      "only one notification a minute",
    )
    expect(posts).toHaveLength(1)
    const tooLong = await client.callTool({
      name: "notify_user",
      arguments: { text: "y".repeat(600) },
    })
    expect(tooLong.isError).toBe(true)
  })

  it("create_checkpoint records the working tree under refs/gatehouse and leaves .env out", async () => {
    fs.writeFileSync(path.join(repo, "a.txt"), "two\n")
    const r = await callText("create_checkpoint", { label: "before the big change" })
    expect(r.isError).toBe(false)
    const ref = /as (refs\/gatehouse\/checkpoints\/[^ ]+)\./.exec(r.text)?.[1] as string
    expect(ref).toMatch(/^refs\/gatehouse\/checkpoints\/stdio-sess\//)
    expect(git(repo, "show", `${ref}:a.txt`)).toBe("two")
    expect(git(repo, "ls-tree", "-r", "--name-only", ref).split("\n")).not.toContain(".env")
  })

  it("get_policy_summary describes the policy", async () => {
    const r = await callText("get_policy_summary")
    expect(r.isError).toBe(false)
    expect(r.text).toContain("These run without asking")
    expect(r.text).toContain("git status*")
  })

  it("reports a Host that is down as not sent, not as a crash", async () => {
    const lonely = new Client({ name: "lonely", version: "0.0.0" })
    await lonely.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", TSX, MAIN],
        cwd: repo,
        env: {
          ...(process.env as Record<string, string>),
          GATEHOUSE_SESSION_ID: "s2",
          GATEHOUSE_HOST_URL: "http://127.0.0.1:9",
          GATEHOUSE_DATA_DIR: path.join(root, "data"),
          GATEHOUSE_RULES_PATH: path.join(root, "rules.yaml"),
        },
      }),
    )
    const r = await lonely.callTool({ name: "notify_user", arguments: { text: "hello" } })
    expect((r.content as { text: string }[])[0]?.text).toContain("could not be reached")
    await lonely.close()
  })
})
