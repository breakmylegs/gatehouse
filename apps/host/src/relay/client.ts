import type { Sealed } from "@gatehouse/shared/e2e"

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface RemoteDecision {
  id: string
  phoneId: string
  requestId: string | null
  sealed: Sealed
  createdAt: string
}

export interface RemotePairing {
  status: "waiting" | "registered" | "confirmed" | "expired"
  registration?: {
    phoneName: string
    ecdhPublicKey: string
    registration: Record<string, unknown>
    pushSubscription?: unknown
  }
  phoneId?: string
}

/** The laptop side of the Relay's device API. Every call has a time limit, and a failure is an exception, never a guess. */
export class RelayClient {
  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async #call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(this.url.replace(/\/$/, "") + path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      throw new RelayError(
        0,
        `Could not reach the Relay (${(e as Error).name === "TimeoutError" ? "timed out" : "network error"})`,
      )
    }
    const text = await res.text()
    // A reply that is not JSON (an edge block page, a proxy error) is reported with its status, not hidden.
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      throw new RelayError(
        res.status,
        `The Relay answered ${res.status} with something that was not JSON`,
      )
    }
    if (!res.ok)
      throw new RelayError(
        res.status,
        (json as { error?: string } | undefined)?.error ?? `The Relay answered ${res.status}`,
      )
    return json as T
  }

  enrol(enrolToken: string, name: string) {
    return this.#call<{ deviceId: string; token: string }>("POST", "/api/device/enroll", {
      enrolToken,
      name,
    })
  }
  config() {
    return this.#call<{ vapidPublicKey: string; rpId: string; origin: string }>(
      "GET",
      "/api/public/config",
    )
  }
  createPairing(code: string, challenge: string, hostPublicKey: string) {
    return this.#call<{ id: string; expiresAt: string; rpId: string; origin: string }>(
      "POST",
      "/api/device/pairings",
      { code, challenge, hostPublicKey },
    )
  }
  pairing(id: string) {
    return this.#call<RemotePairing>("GET", `/api/device/pairings/${id}`)
  }
  confirmPairing(
    id: string,
    body: { credentialId: string; credentialPublicKey: string; counter: number },
  ) {
    return this.#call<{ phoneId: string }>("POST", `/api/device/pairings/${id}/confirm`, body)
  }
  phones() {
    return this.#call<Array<{ id: string; name: string; push: boolean }>>(
      "GET",
      "/api/device/phones",
    )
  }
  renamePhone(id: string, name: string) {
    return this.#call<{ ok: true }>("PUT", `/api/device/phones/${id}`, { name })
  }
  revokePhone(id: string) {
    return this.#call<{ ok: true }>("DELETE", `/api/device/phones/${id}`)
  }
  putRequest(body: {
    id: string
    phoneId: string
    sealed: Sealed
    expiresAt: string
    priority: "normal" | "high"
  }) {
    return this.#call<{ ok: true }>("POST", "/api/device/requests", body)
  }
  markResolved(id: string, summary: string) {
    return this.#call<{ ok: true }>("POST", `/api/device/requests/${id}/resolved`, { summary })
  }
  notify(phoneId: string, kind: "stop" | "idle" | "notify" | "info", sealed: Sealed) {
    return this.#call<{ ok: true }>("POST", "/api/device/notify", { phoneId, kind, sealed })
  }
  decisions(waitSeconds: number) {
    return this.#call<RemoteDecision[]>(
      "GET",
      `/api/device/decisions?wait=${waitSeconds}`,
      undefined,
      (waitSeconds + 10) * 1000,
    )
  }
  ack(id: string) {
    return this.#call<{ ok: true }>("DELETE", `/api/device/decisions/${id}`)
  }
}
