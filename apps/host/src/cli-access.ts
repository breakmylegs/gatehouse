import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { Protector } from "./relay/protector.js"
import { extractToken, secretsEqual } from "./server-guard.js"

/**
 * T-124 (safe variant): scripts on this computer drive sessions through a `codehouse` command (cli-client.ts).
 * - Off until you switch it on in Settings. Switching it on makes a token of its own, sealed for you (DPAPI on Windows,
 *   the Keychain on a Mac) in the data folder with the Host's port; switching it off deletes it and the token stops.
 * - Under /cli, not /api: the per-launch token is not given out, and this token opens nothing else. The Host and Origin
 *   checks apply as to every request (invariant 7), so no web page can use it.
 * - It can list sessions, start one in a project folder in Manual mode (never Extreme approval or another mode), send
 *   a prompt and wait for the turn, and read a session's state and last answer. It can never answer a decision, change
 *   the policy or a mode, or touch the kill switch: there is no route for them.
 * - Every call is recorded, by what it did, never by the prompt.
 */
export const CLI_TOKEN_FILE = "cli-token.sealed"
export const CLI_PORT_FILE = "cli.json"
export const MAX_PROMPT = 8000
export const WAIT_MS = 10 * 60_000

export interface CliSession {
  id: string
  title?: string
  cwd: string
  state: string
  createdAt: string
}

export interface CliDeps {
  list: () => CliSession[]
  /** Starts a session in a folder in Manual mode, through every check a session you start goes through. */
  start: (cwd: string) => Promise<string>
  /** Sends a prompt to an open session; false when there is none. */
  send: (id: string, prompt: string) => boolean
  /** A session's state and the last answer it finished with, or undefined. */
  read: (id: string) => { session: CliSession; lastAnswer: string } | undefined
  /** Resolves when the session's turn ends (idle, error or closed), or after `ms`. */
  settled: (id: string, ms: number) => Promise<void>
  record: (action: string, input: Record<string, unknown>, ok: boolean, why: string) => Promise<boolean>
}

/** What the command line is told of a session. */
export const cliSession = (i: { id: string; title?: string; cwd: string; state: string; createdAt: string }): CliSession => ({
  id: i.id,
  ...(i.title ? { title: i.title } : {}),
  cwd: i.cwd,
  state: i.state,
  createdAt: i.createdAt,
})

/**
 * Resolves when a session's turn is over: idle, failed or gone, once it has been seen working (or after a few seconds
 * if it never was), or after `ms` in any case.
 */
export async function settledSession(state: () => string | undefined, ms: number, everyMs = 500, graceMs = 5000): Promise<void> {
  const start = Date.now()
  let busy = false
  while (Date.now() - start < ms) {
    const st = state()
    if (st === undefined || st === "ended" || st === "error") return
    if (st === "running" || st === "waiting" || st === "starting") busy = true
    else if (st === "idle" && (busy || Date.now() - start >= graceMs)) return
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

/** The command line's token: sealed on disk for this user, held in memory by the Host while it is switched on. */
export class CliAccess {
  #token: string | undefined
  constructor(
    private readonly dir: string,
    /** Asked for only when it is needed: finding the helper may build it. */
    private readonly protector: () => Protector,
  ) {}

  get enabled(): boolean {
    return this.#token !== undefined
  }

  /** Makes a new token and seals it, with the port, for the command; an earlier one stops working. */
  async enable(port: number): Promise<void> {
    const token = randomBytes(32).toString("base64url")
    const sealed = await this.protector().protect(new TextEncoder().encode(token))
    fs.mkdirSync(this.dir, { recursive: true })
    await writeFileAtomic(path.join(this.dir, CLI_TOKEN_FILE), Buffer.from(sealed).toString("base64") + "\n")
    await writeFileAtomic(path.join(this.dir, CLI_PORT_FILE), JSON.stringify({ port }) + "\n")
    this.#token = token
  }

  /** At start, when it was left on: the sealed token read back, or a new one if it cannot be. */
  async resume(port: number): Promise<void> {
    try {
      const raw = Buffer.from(fs.readFileSync(path.join(this.dir, CLI_TOKEN_FILE), "utf8").trim(), "base64")
      this.#token = new TextDecoder().decode(await this.protector().unprotect(new Uint8Array(raw)))
      await writeFileAtomic(path.join(this.dir, CLI_PORT_FILE), JSON.stringify({ port }) + "\n")
    } catch {
      await this.enable(port)
    }
  }

  /** At start: back on if it was left on (its sealed token is there). */
  async resumeIfOn(port: number): Promise<void> {
    if (fs.existsSync(path.join(this.dir, CLI_TOKEN_FILE))) await this.resume(port)
  }

  disable(): void {
    this.#token = undefined
    for (const f of [CLI_TOKEN_FILE, CLI_PORT_FILE]) fs.rmSync(path.join(this.dir, f), { force: true })
  }

  allows(presented: string | undefined): boolean {
    return this.#token !== undefined && presented !== undefined && secretsEqual(presented, this.#token)
  }
}

const no = (reply: FastifyReply, status: number, error: string) => reply.code(status).send({ error })

export function registerCliRoutes(app: FastifyInstance, access: CliAccess, d: CliDeps): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!(req.url === "/cli" || req.url.startsWith("/cli/"))) return
    if (!access.allows(extractToken(req.headers))) return no(reply, 401, "unauthorized")
  })
  app.get("/cli/sessions", async () => {
    await d.record("list", {}, true, "The command line listed the sessions.")
    return { sessions: d.list() }
  })
  app.post("/cli/sessions", async (req, reply) => {
    const b = (req.body ?? {}) as { cwd?: unknown; prompt?: unknown }
    const cwd = typeof b.cwd === "string" ? b.cwd.trim() : ""
    const prompt = typeof b.prompt === "string" ? b.prompt : ""
    if (!cwd) return no(reply, 400, "Give the project folder to start in.")
    if (prompt.length > MAX_PROMPT) return no(reply, 400, `A prompt is up to ${MAX_PROMPT} characters.`)
    try {
      const id = await d.start(cwd)
      if (prompt) d.send(id, prompt)
      await d.record("start", { id, cwd, prompt: prompt.length }, true, "The command line started a session in Manual mode.")
      return { id }
    } catch (e) {
      await d.record("start", { cwd }, false, `The command line could not start a session: ${(e as Error).message}`)
      return no(reply, 409, `It did not start: ${(e as Error).message}`)
    }
  })
  app.post("/cli/sessions/:id/send", async (req, reply) => {
    const id = (req.params as { id: string }).id
    const b = (req.body ?? {}) as { prompt?: unknown; wait?: unknown }
    const prompt = typeof b.prompt === "string" ? b.prompt : ""
    if (!prompt.trim() || prompt.length > MAX_PROMPT) return no(reply, 400, `A prompt of 1 to ${MAX_PROMPT} characters.`)
    if (!d.send(id, prompt)) {
      await d.record("send", { id }, false, "The command line sent to a session that is not open.")
      return no(reply, 404, "That session is not open.")
    }
    await d.record("send", { id, prompt: prompt.length, wait: b.wait === true }, true, "The command line sent a prompt.")
    if (b.wait !== true) return { sent: true }
    await d.settled(id, WAIT_MS)
    return { sent: true, ...(d.read(id) ?? {}) }
  })
  app.get("/cli/sessions/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id
    const r = d.read(id)
    if (!r) return no(reply, 404, "That session is not open.")
    await d.record("show", { id }, true, "The command line read a session.")
    return r
  })
}
