import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "../hostaudit.js"
import type { RemoteVia } from "../server.js"
import { CnwConnector, type VirtualSocket } from "./connector.js"
import { pair, type Pairing } from "./pairing.js"

/**
 * O41: Neighbourhood Watch in Codehouse: the pairing kept in the data folder (the address, this computer's id and the
 * pinned certificate), the private key sealed for this Windows user, and the connector, started when paired and on.
 * Pairing, turning it on or off, and unpairing are recorded, from the desktop only (the admin API).
 */
interface Saved extends Pairing {
  on: boolean
}

export interface CnwDeps {
  dataDir: string
  version: string
  audit: Pick<HostAudit, "record">
  /** DPAPI on Windows (the Mac's Keychain on a Mac): seals and opens the private key for this user. */
  seal: (plain: Buffer) => Promise<Buffer>
  open: (sealed: Buffer) => Promise<Buffer>
  log: (line: string) => void
}

export class CnwService {
  readonly #d: CnwDeps
  #attach: ((s: VirtualSocket, via: RemoteVia) => void) | undefined
  #conn: CnwConnector | undefined

  constructor(d: CnwDeps) {
    this.#d = d
  }

  get #file() {
    return path.join(this.#d.dataDir, "neighbourhood-watch.json")
  }
  get #keyFile() {
    return path.join(this.#d.dataDir, "neighbourhood-watch.key")
  }

  saved(): Saved | undefined {
    try {
      const v = JSON.parse(fs.readFileSync(this.#file, "utf8")) as Partial<Saved>
      return typeof v.url === "string" && typeof v.computerId === "string" && typeof v.certSha256 === "string"
        ? { url: v.url, computerId: v.computerId, certSha256: v.certSha256, on: v.on !== false }
        : undefined
    } catch {
      return undefined
    }
  }

  #save(s: Saved | undefined): void {
    if (!s) return void fs.rmSync(this.#file, { force: true })
    const tmp = `${this.#file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2))
    fs.renameSync(tmp, this.#file)
  }

  status(): { paired: boolean; on: boolean; url?: string; state: CnwConnector["status"]; refusal?: "removed" | "certificate"; needsUpdate?: "cnw" | "codehouse" } {
    const s = this.saved()
    const refusal = this.#conn?.status === "refused" ? this.#conn.refusal : undefined
    const needsUpdate = this.#conn?.status === "connected" ? this.#conn.needsUpdate : undefined
    return { paired: Boolean(s), on: s?.on ?? false, ...(s ? { url: s.url } : {}), state: this.#conn?.status ?? "off", ...(refusal ? { refusal } : {}), ...(needsUpdate ? { needsUpdate } : {}) }
  }

  /** Called once the Host's server is up: CNW's commands join it as clients. */
  async start(attach: (s: VirtualSocket, via: RemoteVia) => void): Promise<void> {
    this.#attach = attach
    const s = this.saved()
    if (s?.on) await this.#connect(s)
  }

  async #connect(s: Saved): Promise<void> {
    this.#conn?.stop()
    if (!this.#attach) return
    let key: Buffer
    try {
      key = await this.#d.open(fs.readFileSync(this.#keyFile))
    } catch {
      this.#d.log("neighbourhood watch: this computer's key could not be opened; pair it again")
      return
    }
    this.#conn = new CnwConnector({
      url: s.url,
      computerId: s.computerId,
      privateKey: key,
      certSha256: s.certSha256,
      version: this.#d.version,
      attach: this.#attach,
      log: this.#d.log,
    })
    this.#conn.start()
  }

  #record(event: string, input: Record<string, unknown>, reason: string) {
    return this.#d.audit.record({
      session: "desktop",
      event,
      channel: "desktop",
      tool: "neighbourhood-watch",
      input,
      verdict: { outcome: "allow", ruleId: event.replace(/_/g, "-"), reason, risk: 0, decidedBy: "human-desktop", policyHash: "" },
      latencyMs: 0,
    })
  }

  async pair(url: string, code: string, label: string): Promise<void> {
    let sealedKey: Buffer | undefined
    const p = await pair(url, code, label, { seal: async (k) => void (sealedKey = await this.#d.seal(k)) })
    fs.mkdirSync(this.#d.dataDir, { recursive: true })
    fs.writeFileSync(this.#keyFile, sealedKey!, { mode: 0o600 })
    this.#save({ ...p, on: true })
    await this.#record("cnw_paired", { url: p.url, computer: p.computerId }, "This computer was paired with Neighbourhood Watch from the desktop.")
    await this.#connect({ ...p, on: true })
  }

  async setOn(on: boolean): Promise<void> {
    const s = this.saved()
    if (!s) throw new Error("This computer is not paired with Neighbourhood Watch.")
    this.#save({ ...s, on })
    await this.#record(on ? "cnw_on" : "cnw_off", { url: s.url }, `Neighbourhood Watch was turned ${on ? "on" : "off"} from the desktop.`)
    if (on) await this.#connect({ ...s, on })
    else this.#conn?.stop()
  }

  async unpair(): Promise<void> {
    const s = this.saved()
    this.#conn?.stop()
    this.#conn = undefined
    this.#save(undefined)
    fs.rmSync(this.#keyFile, { force: true })
    if (s) await this.#record("cnw_unpaired", { url: s.url }, "This computer was unpaired from Neighbourhood Watch from the desktop.")
  }

  stop(): void {
    this.#conn?.stop()
  }
}

/** GET /api/cnw, POST /api/cnw/pair, POST /api/cnw/on, DELETE /api/cnw: the desktop's Settings, Neighbourhood Watch. */
export function registerCnwRoutes(app: FastifyInstance, cnw: CnwService): void {
  app.get("/api/cnw", async () => cnw.status())
  app.post("/api/cnw/pair", async (req, reply) => {
    const b = z.object({ url: z.string().max(300), code: z.string().max(20), label: z.string().max(60).optional() }).safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "Neighbourhood Watch's address and the code it shows." })
    try {
      await cnw.pair(b.data.url, b.data.code, b.data.label ?? "")
      return cnw.status()
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })
  app.post("/api/cnw/on", async (req, reply) => {
    try {
      await cnw.setOn((req.body as { on?: unknown })?.on === true)
      return cnw.status()
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })
  app.delete("/api/cnw", async () => {
    await cnw.unpair()
    return cnw.status()
  })
}
