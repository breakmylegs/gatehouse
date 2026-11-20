import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "../hostaudit.js"
import type { RemoteVia } from "../server.js"
import { CnwConnector, type VirtualSocket } from "./connector.js"
import { checkUrl, pair, type Pairing } from "./pairing.js"
import { checkRootPem, grouped, pemSha256, trustFor, type Trust } from "./trust.js"

/**
 * O41: Neighbourhood Watch in Codehouse: the pairing kept in the data folder (the address, this computer's id and the
 * pinned certificate), the private key sealed for this Windows user, and the connector, started when paired and on.
 * Pairing, turning it on or off, and unpairing are recorded, from the desktop only (the admin API).
 */
interface Saved extends Pairing {
  on: boolean
}

/** A trust as kept, checked; undefined for anything else (a file from a newer version keeps it, an older drops it). */
function readTrust(v: unknown): Trust | undefined {
  const t = v as Partial<{ kind: string; pem: string; sha256: string }> | undefined
  if (t?.kind === "public") return { kind: "public" }
  if (t?.kind === "root" && typeof t.pem === "string") {
    const pem = checkRootPem(t.pem)
    return typeof pem === "string" ? { kind: "root", pem, sha256: pemSha256(pem) } : undefined
  }
  return undefined
}

export interface CnwDeps {
  dataDir: string
  version: string
  audit: Pick<HostAudit, "record">
  /** DPAPI on Windows (the Mac's Keychain on a Mac): seals and opens the private key for this user. */
  seal: (plain: Buffer) => Promise<Buffer>
  open: (sealed: Buffer) => Promise<Buffer>
  log: (line: string) => void
  /** For tests. */
  trustFor?: (u: URL) => Promise<Trust | undefined>
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
        ? (() => {
            const trust = readTrust(v.trust)
            return { url: v.url, computerId: v.computerId, certSha256: v.certSha256, ...(trust ? { trust } : {}), on: v.on !== false }
          })()
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

  status(): { paired: boolean; on: boolean; url?: string; state: CnwConnector["status"]; refusal?: "removed" | "certificate"; needsUpdate?: "cnw" | "codehouse"; trust?: Trust["kind"]; root?: string } {
    const s = this.saved()
    const refusal = this.#conn?.status === "refused" ? this.#conn.refusal : undefined
    const needsUpdate = this.#conn?.status === "connected" ? this.#conn.needsUpdate : undefined
    const trust = s?.trust ?? (s ? ({ kind: "leaf", sha256: s.certSha256 } as const) : undefined)
    return {
      paired: Boolean(s),
      on: s?.on ?? false,
      ...(s ? { url: s.url } : {}),
      state: this.#conn?.status ?? "off",
      ...(refusal ? { refusal } : {}),
      ...(needsUpdate ? { needsUpdate } : {}),
      ...(trust ? { trust: trust.kind } : {}),
      ...(trust?.kind === "root" ? { root: grouped(trust.sha256) } : {}),
    }
  }

  /**
   * ADR 0020: what "Trust CNW's certificate again" would trust, looked at now: CNW's root as it gives it, checked
   * against its own certificate (chain and address), with its fingerprint for you to compare with CNW's Server page.
   * Nothing is kept until you confirm that fingerprint.
   */
  async candidate(): Promise<{ kind: Trust["kind"]; root?: string }> {
    const s = this.saved()
    if (!s) throw new Error("This computer is not paired with Neighbourhood Watch.")
    const t = await (this.#d.trustFor ?? trustFor)(checkUrl(s.url))
    if (!t) throw new Error("This Neighbourhood Watch gives no root certificate. Update it, or pair again.")
    return { kind: t.kind, ...(t.kind === "root" ? { root: grouped(t.sha256) } : {}) }
  }

  /** Trusts CNW's certificate again, keeping this computer's id and key, once you confirm the fingerprint you saw. */
  async trustAgain(fingerprint: string): Promise<void> {
    const s = this.saved()
    if (!s) throw new Error("This computer is not paired with Neighbourhood Watch.")
    const t = await (this.#d.trustFor ?? trustFor)(checkUrl(s.url))
    if (!t) throw new Error("This Neighbourhood Watch gives no root certificate. Update it, or pair again.")
    const seen = t.kind === "root" ? grouped(t.sha256) : "public"
    if (fingerprint.replace(/\s+/g, "").toUpperCase() !== seen.replace(/\s+/g, "").toUpperCase())
      throw new Error("CNW's certificate is not the one you confirmed, so nothing changed. Look again.")
    const next: Saved = { ...s, trust: t }
    this.#save(next)
    await this.#record("cnw_trusted_again", { url: s.url, computer: s.computerId, trust: t.kind, ...(t.kind === "root" ? { root: t.sha256 } : {}) }, "Neighbourhood Watch's certificate was trusted again from the desktop.")
    if (next.on) await this.#connect(next)
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
      ...(s.trust ? { trust: s.trust } : {}),
      version: this.#d.version,
      attach: this.#attach,
      log: this.#d.log,
    })
    // ADR 0020: a leaf-pinned pairing moved to CNW's root by itself: kept, and recorded.
    this.#conn.on("trust", (t: Trust) => {
      const now = this.saved()
      if (!now || now.computerId !== s.computerId) return
      this.#save({ ...now, trust: t })
      void this.#record("cnw_trust_moved", { url: now.url, computer: now.computerId, trust: t.kind, ...(t.kind === "root" ? { root: t.sha256 } : {}) }, "Neighbourhood Watch's pairing moved from its certificate to its root certificate, while the certificate still matched.")
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
  // ADR 0020: Trust CNW's certificate again, in two steps: look (its root's fingerprint), then confirm it.
  app.get("/api/cnw/trust-again", async (_req, reply) => {
    try {
      return await cnw.candidate()
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message })
    }
  })
  app.post("/api/cnw/trust-again", async (req, reply) => {
    const b = z.object({ fingerprint: z.string().min(1).max(200) }).safeParse(req.body)
    if (!b.success) return reply.code(422).send({ error: "Confirm the fingerprint you were shown." })
    try {
      await cnw.trustAgain(b.data.fingerprint)
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
