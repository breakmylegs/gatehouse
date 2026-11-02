export interface NotifyMessage {
  sessionId: string
  /** Already redacted and length-limited by the Companion. */
  text: string
}

/** How the Companion reaches the Host. Injectable so tests need no network. */
export interface HostClient {
  /** Resolves true when the Host accepted the notification. Never throws. */
  notify(message: NotifyMessage): Promise<boolean>
}

/**
 * Posts to the Host's loopback endpoint with the per-launch token. The endpoint is added with the Host in
 * a later phase, until then a refusal is reported to the agent as "not sent".
 */
export class HttpHostClient implements HostClient {
  readonly #base: string
  readonly #token: string
  readonly #timeoutMs: number

  constructor(base: string, token: string, timeoutMs = 2000) {
    this.#base = base.replace(/\/+$/, "")
    this.#token = token
    this.#timeoutMs = timeoutMs
  }

  async notify(message: NotifyMessage): Promise<boolean> {
    try {
      const res = await fetch(`${this.#base}/internal/notify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#token}` },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
