import fs from "node:fs"
import path from "node:path"
import type { PendingView } from "@gatehouse/shared"
import type { Broker } from "../broker.js"
import type { Protector } from "../relay/protector.js"
import { PushCodes, riskBand, SEVERE, summarise } from "./codes.js"

/**
 * Push notifications through Slack, outbound only. JCVC posts each request with Approve and Deny buttons, and hears
 * your tap through Slack's Socket Mode: a WebSocket this computer opens to Slack, so nothing reaches in. Only taps by
 * the Slack user you name count, each button works once for that one request, and the tokens are kept encrypted with
 * Windows' DPAPI, never in the settings file.
 */
export interface SlackSettings {
  enabled: boolean
  /** Where requests are posted: a channel id, or your own member id for a direct message from the app. */
  channel: string
  /** Your Slack member id. Taps by anyone else are refused. */
  userId: string
  maxRisk: number
}

export interface SlackSecrets {
  botToken: string
  appToken: string
}

export interface SlackStatus {
  enabled: boolean
  connected: boolean
  channel?: string
  userId?: string
  maxRisk?: number
  hasTokens: boolean
  lastError?: string
  sent: number
}

/** Keeps the two Slack tokens encrypted on disk. */
export class SlackSecretStore {
  readonly #file: string
  readonly #protector: Protector

  constructor(file: string, protector: Protector) {
    this.#file = file
    this.#protector = protector
  }

  async load(): Promise<SlackSecrets | undefined> {
    if (!fs.existsSync(this.#file)) return undefined
    try {
      const plain = await this.#protector.unprotect(new Uint8Array(fs.readFileSync(this.#file)))
      const v = JSON.parse(Buffer.from(plain).toString("utf8")) as Partial<SlackSecrets>
      return typeof v.botToken === "string" && typeof v.appToken === "string"
        ? { botToken: v.botToken, appToken: v.appToken }
        : undefined
    } catch {
      return undefined
    }
  }

  async save(secrets: SlackSecrets): Promise<void> {
    const sealed = await this.#protector.protect(Buffer.from(JSON.stringify(secrets), "utf8"))
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    const tmp = this.#file + ".tmp"
    fs.writeFileSync(tmp, sealed)
    fs.renameSync(tmp, this.#file)
  }

  forget(): void {
    fs.rmSync(this.#file, { force: true })
  }
}

interface MinimalSocket {
  send(data: string): void
  close(): void
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

export interface SlackDeps {
  broker: Broker
  settings: () => SlackSettings | undefined
  secrets: () => Promise<SlackSecrets | undefined>
  redact: (text: string) => string
  expiryMs: () => number
  onRefused: (reason: string, requestId?: string) => void
  log: (line: string) => void
  fetchImpl?: typeof fetch
  socketFactory?: (url: string) => MinimalSocket
  now?: () => number
}

const VALUE = /^(allow|deny) ([0-9a-f-]{36}) ([A-Za-z0-9_-]{22,64})$/

export class SlackChannel {
  readonly #d: SlackDeps
  readonly #codes: PushCodes
  readonly #posted = new Map<string, { channel: string; ts: string; text: string }>()
  #socket: MinimalSocket | undefined
  #running = false
  #status: Omit<SlackStatus, "enabled" | "hasTokens"> = { connected: false, sent: 0 }
  #hasTokens = false
  #onCreated = (v: PendingView) => void this.notify(v)
  #onResolved = ({
    id,
    resolution,
  }: {
    id: string
    resolution: { outcome: string; channel: string }
  }) => {
    this.#codes.forget(id)
    void this.#close(id, resolution.outcome, resolution.channel)
  }

  constructor(deps: SlackDeps) {
    this.#d = deps
    this.#codes = new PushCodes({
      broker: deps.broker,
      expiryMs: deps.expiryMs,
      onRefused: deps.onRefused,
      ...(deps.now ? { now: deps.now } : {}),
    })
  }

  status(): SlackStatus {
    const s = this.#d.settings()
    return {
      ...this.#status,
      enabled: s?.enabled === true,
      hasTokens: this.#hasTokens,
      ...(s
        ? { channel: s.channel, userId: s.userId, maxRisk: Math.min(s.maxRisk, SEVERE - 1) }
        : {}),
    }
  }

  async start(): Promise<void> {
    if (this.#running) return
    const s = this.#d.settings()
    const secrets = await this.#d.secrets()
    this.#hasTokens = secrets !== undefined
    if (!s?.enabled || !secrets) return
    this.#running = true
    this.#d.broker.on("created", this.#onCreated)
    this.#d.broker.on("resolved", this.#onResolved)
    void this.#connect(1000)
  }

  stop(): void {
    this.#running = false
    this.#d.broker.off("created", this.#onCreated)
    this.#d.broker.off("resolved", this.#onResolved)
    this.#socket?.close()
    this.#socket = undefined
    this.#codes.clear()
    this.#status = { ...this.#status, connected: false }
  }

  async #api(
    method: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await (this.#d.fetchImpl ?? fetch)(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as Record<string, unknown>
    if (json.ok !== true)
      throw new Error(`Slack ${method} failed: ${String(json.error ?? res.status)}`)
    return json
  }

  async notify(view: PendingView): Promise<void> {
    const s = this.#d.settings()
    const secrets = await this.#d.secrets()
    if (!s?.enabled || !secrets) return
    const r = view.request
    const { allow, deny } = this.#codes.issue(view, s.maxRisk)
    const text = this.#d.redact(
      `JCVC: ${r.project} needs you. ${r.toolName}: ${summarise(view, this.#d.redact)} Risk ${r.verdict.risk} ${riskBand(r.verdict.risk)}, rule ${r.verdict.ruleId}.`,
    )
    const buttons = [
      ...(allow
        ? [
            {
              type: "button",
              style: "primary",
              action_id: "jcvc_allow",
              text: { type: "plain_text", text: "Approve" },
              value: `allow ${r.id} ${allow}`,
            },
          ]
        : []),
      ...(r.kind === "question"
        ? []
        : [
            {
              type: "button",
              style: "danger",
              action_id: "jcvc_deny",
              text: { type: "plain_text", text: "Deny" },
              value: `deny ${r.id} ${deny}`,
            },
          ]),
    ]
    const note = allow
      ? ""
      : r.kind === "question"
        ? "Answer it in JCVC."
        : "Too risky to approve from here: decide in JCVC, or deny."
    try {
      const out = await this.#api("chat.postMessage", secrets.botToken, {
        channel: s.channel,
        text,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text } },
          ...(note ? [{ type: "context", elements: [{ type: "mrkdwn", text: note }] }] : []),
          ...(buttons.length
            ? [{ type: "actions", block_id: `jcvc_${r.id}`, elements: buttons }]
            : []),
        ],
      })
      if (typeof out.channel === "string" && typeof out.ts === "string")
        this.#posted.set(r.id, { channel: out.channel, ts: out.ts, text })
      this.#status = { ...this.#status, sent: this.#status.sent + 1, lastError: undefined }
    } catch (e) {
      this.#status = { ...this.#status, lastError: (e as Error).message }
      this.#d.log(`slack: ${(e as Error).message}`)
    }
  }

  /** Replaces the buttons with what happened, so an old message cannot be tapped again. */
  async #close(id: string, outcome: string, channel: string): Promise<void> {
    const posted = this.#posted.get(id)
    this.#posted.delete(id)
    const secrets = await this.#d.secrets()
    if (!posted || !secrets) return
    const said =
      outcome === "allow"
        ? "Approved"
        : outcome === "deny"
          ? "Denied"
          : outcome === "timeout"
            ? "Timed out"
            : "Cancelled"
    const where =
      channel === "push" ? "from here" : channel === "desktop" ? "on the desktop" : `on ${channel}`
    try {
      await this.#api("chat.update", secrets.botToken, {
        channel: posted.channel,
        ts: posted.ts,
        text: `${posted.text} ${said} ${where}.`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: posted.text } },
          { type: "context", elements: [{ type: "mrkdwn", text: `${said} ${where}.` }] },
        ],
      })
    } catch (e) {
      this.#d.log(`slack: ${(e as Error).message}`)
    }
  }

  /** One Socket Mode message: acknowledge it, then act on a button tap from the right person. */
  handleEnvelope(raw: string): void {
    let msg: {
      envelope_id?: string
      type?: string
      payload?: {
        type?: string
        user?: { id?: string }
        actions?: Array<{ action_id?: string; value?: string }>
      }
    }
    try {
      msg = JSON.parse(raw) as typeof msg
    } catch {
      return
    }
    if (msg.envelope_id) this.#socket?.send(JSON.stringify({ envelope_id: msg.envelope_id }))
    if (msg.type === "disconnect") {
      this.#socket?.close()
      return
    }
    if (msg.type !== "interactive" || msg.payload?.type !== "block_actions") return
    const s = this.#d.settings()
    for (const action of msg.payload.actions ?? []) {
      if (action.action_id !== "jcvc_allow" && action.action_id !== "jcvc_deny") continue
      if (!s || msg.payload.user?.id !== s.userId) {
        this.#d.onRefused("a tap by someone other than you")
        continue
      }
      const m = VALUE.exec(action.value ?? "")
      if (!m) {
        this.#d.onRefused("a button value that is not in the expected form")
        continue
      }
      const [, decision, id, code] = m as unknown as [string, "allow" | "deny", string, string]
      this.#codes.answer(decision, id, code)
    }
  }

  async test(): Promise<{ ok: boolean; error?: string }> {
    const s = this.#d.settings()
    const secrets = await this.#d.secrets()
    if (!s || !secrets) return { ok: false, error: "Slack is not set up yet" }
    try {
      await this.#api("auth.test", secrets.botToken, {})
      await this.#api("chat.postMessage", secrets.botToken, {
        channel: s.channel,
        text: "JCVC test: requests that need you will appear here with Approve and Deny buttons.",
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async #connect(pause: number): Promise<void> {
    if (!this.#running) return
    const secrets = await this.#d.secrets()
    try {
      if (!secrets) throw new Error("no Slack tokens")
      const open = await this.#api("apps.connections.open", secrets.appToken, {})
      const url = String(open.url ?? "")
      if (!url.startsWith("wss://")) throw new Error("Slack did not give a socket address")
      const socket: MinimalSocket = this.#d.socketFactory
        ? this.#d.socketFactory(url)
        : (new WebSocket(url) as unknown as MinimalSocket)
      this.#socket = socket
      socket.onmessage = (ev) => {
        this.#status = { ...this.#status, connected: true, lastError: undefined }
        this.handleEnvelope(typeof ev.data === "string" ? ev.data : String(ev.data))
      }
      socket.onerror = () => {
        this.#status = { ...this.#status, lastError: "The Slack connection had an error" }
      }
      socket.onclose = () => {
        this.#status = { ...this.#status, connected: false }
        if (this.#running) setTimeout(() => void this.#connect(1000), 1000)
      }
    } catch (e) {
      this.#status = { ...this.#status, connected: false, lastError: (e as Error).message }
      if (this.#running) setTimeout(() => void this.#connect(Math.min(pause * 2, 30_000)), pause)
    }
  }
}
