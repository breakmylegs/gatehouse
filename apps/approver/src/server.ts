import http from "node:http"
import type { AddressInfo } from "node:net"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { PolicyEngine, PolicyStore, PwshWorker, redact, type LoadOptions } from "@gatehouse/policy"
import { AuditWriter } from "@gatehouse/shared/audit"
import { assertUsableToken, checkRequest, MAX_BODY_BYTES } from "./guard.js"
import { registerApproverTools, type ApproverDeps } from "./tools.js"

export interface ApproverServerOptions {
  token: string
  /** 0 picks a free port (tests). The server only ever listens on 127.0.0.1. */
  port: number
  rules: LoadOptions
  auditDir: string
  redactTerms?: string[]
  /** Folder that approval_prompt resolves relative paths against. */
  promptCwd?: string
  /** Pass undefined to run without a PowerShell worker (everything PowerShell then escalates). */
  pwsh?: PwshWorker | undefined
  watchRules?: boolean
  maxBodyBytes?: number
  log?: (line: string) => void
}

function jsonRpcError(code: number, message: string) {
  return JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null })
}

/**
 * The Approver: an MCP server over streamable HTTP on 127.0.0.1, stateless, one McpServer per request.
 * Every request passes the guard first. The server never returns details of a failure to the caller.
 */
export class ApproverServer {
  readonly #opts: ApproverServerOptions
  readonly #log: (line: string) => void
  readonly #http: http.Server
  readonly store: PolicyStore
  readonly audit: AuditWriter
  readonly engine: PolicyEngine
  readonly pwsh: PwshWorker | undefined
  #port = 0

  constructor(opts: ApproverServerOptions) {
    this.#opts = { ...opts, token: assertUsableToken(opts.token) }
    this.#log = opts.log ?? (() => undefined)
    this.store = new PolicyStore(opts.rules)
    this.pwsh = opts.pwsh
    this.engine = new PolicyEngine({ getPolicy: () => this.store.current, pwsh: this.pwsh })
    const terms = opts.redactTerms ?? []
    this.audit = new AuditWriter({ dir: opts.auditDir, redact: (v) => redact(v, { terms }) })
    this.#http = http.createServer((req, res) => {
      this.#handle(req, res).catch((e) => {
        this.#log(`request failed (${(e as Error).name})`)
        if (!res.headersSent) this.#send(res, 500, jsonRpcError(-32603, "Internal error"))
        else res.end()
      })
    })
    this.#http.requestTimeout = 30_000
    this.#http.headersTimeout = 10_000
  }

  get port(): number {
    return this.#port
  }

  /** The address the listener is bound to. Always 127.0.0.1 (invariant 7). */
  get address(): string | undefined {
    const a = this.#http.address()
    return typeof a === "object" && a !== null ? a.address : undefined
  }

  async start(): Promise<number> {
    this.store.load()
    if (this.store.status().errors.length > 0) {
      this.#log(`policy did not load: ${this.store.status().errors.join("; ")}`)
    }
    if (this.#opts.watchRules) this.store.watch()
    if (this.pwsh)
      await this.pwsh
        .start()
        .catch((e) => this.#log(`PowerShell worker did not start (${(e as Error).message})`))
    await new Promise<void>((resolve, reject) => {
      this.#http.once("error", reject)
      // Invariant 7: loopback only, whatever the machine's network setup.
      this.#http.listen(this.#opts.port, "127.0.0.1", () => resolve())
    })
    this.#port = (this.#http.address() as AddressInfo).port
    return this.#port
  }

  async close(): Promise<void> {
    this.store.close()
    this.pwsh?.close()
    this.#http.closeAllConnections()
    await new Promise<void>((resolve) => this.#http.close(() => resolve()))
  }

  #send(
    res: http.ServerResponse,
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ): void {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    })
    res.end(body)
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const guard = checkRequest(req, { token: this.#opts.token, port: this.#port })
    if (!guard.ok) {
      this.#send(res, guard.status, JSON.stringify({ error: guard.error }), guard.headers)
      req.resume()
      return
    }
    const limit = this.#opts.maxBodyBytes ?? MAX_BODY_BYTES
    const declared = Number(req.headers["content-length"])
    if (Number.isFinite(declared) && declared > limit) {
      this.#send(res, 413, JSON.stringify({ error: "payload too large" }), { connection: "close" })
      req.destroy()
      return
    }
    const body = await this.#readBody(req, limit)
    if (body === undefined) {
      this.#send(res, 413, JSON.stringify({ error: "payload too large" }), { connection: "close" })
      req.destroy()
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      this.#send(res, 400, jsonRpcError(-32700, "Parse error"))
      return
    }

    const deps: ApproverDeps = {
      engine: this.engine,
      store: this.store,
      audit: this.audit,
      pwsh: this.pwsh,
      promptCwd: this.#opts.promptCwd ?? process.cwd(),
      log: this.#log,
    }
    const mcp = new McpServer({ name: "gatehouse-approver", version: "0.0.0" })
    registerApproverTools(mcp, deps)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    res.on("close", () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res, parsed)
  }

  #readBody(req: http.IncomingMessage, limit: number): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > limit) {
          chunks.length = 0
          resolve(undefined)
          return
        }
        chunks.push(chunk)
      })
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      req.on("error", reject)
    })
  }
}
