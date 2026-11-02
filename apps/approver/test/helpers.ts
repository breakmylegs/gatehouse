import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { PwshWorker } from "@gatehouse/policy"
import {
  fwd,
  makeFixture,
  SEED_RULES,
  type Fixture,
} from "../../../packages/policy/test/helpers.js"
import { ApproverServer, type ApproverServerOptions } from "../src/server.js"

export const TOKEN = "t".repeat(16) + "k".repeat(16) + "-gatehouse-test-token"

export interface Running {
  server: ApproverServer
  port: number
  fx: Fixture
  dir: string
  auditDir: string
  rulesPath: string
  cwd: string
  url: string
  client(token?: string): Promise<Client>
  call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ structured: any; text: any; isError: boolean }>
  stop(): Promise<void>
}

export interface StartOptions {
  rulesText?: string
  auditDir?: string
  pwsh?: PwshWorker | undefined
  redactTerms?: string[]
  watchRules?: boolean
  statePath?: string
  server?: Partial<ApproverServerOptions>
}

export async function startApprover(opts: StartOptions = {}): Promise<Running> {
  const fx = makeFixture()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-approver-"))
  const rulesPath = path.join(dir, "rules.yaml")
  fs.writeFileSync(rulesPath, opts.rulesText ?? fs.readFileSync(SEED_RULES, "utf8"))
  const auditDir = opts.auditDir ?? path.join(dir, "audit")
  const server = new ApproverServer({
    token: TOKEN,
    port: 0,
    rules: { rulesPath, workspaceRootsOverride: [fwd(fx.ws)] },
    auditDir,
    redactTerms: opts.redactTerms ?? [],
    promptCwd: fx.ws,
    pwsh: "pwsh" in opts ? opts.pwsh : new PwshWorker(),
    watchRules: opts.watchRules ?? false,
    // Every test server gets its own state file, so no test engages another's kill switch.
    env: { ...process.env, GATEHOUSE_STATE: opts.statePath ?? path.join(dir, "state.json") },
    ...opts.server,
  })
  const port = await server.start()
  const url = `http://127.0.0.1:${port}/mcp`
  const clients: Client[] = []
  const client = async (token = TOKEN) => {
    const c = new Client({ name: "approver-test", version: "0.0.0" })
    await c.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    )
    clients.push(c)
    return c
  }
  const shared = await client()
  return {
    server,
    port,
    fx,
    dir,
    auditDir,
    rulesPath,
    cwd: fwd(fx.ws),
    url,
    client,
    async call(name, args) {
      const r = await shared.callTool({ name, arguments: args })
      const content = r.content as { type: string; text: string }[]
      let text: unknown
      try {
        text = JSON.parse(content[0]?.text ?? "null")
      } catch {
        text = content[0]?.text
      }
      return { structured: r.structuredContent, text, isError: r.isError === true }
    },
    async stop() {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)))
      await server.close()
      fx.dispose()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
