import webpush from "web-push"
import type { Store } from "./db.js"

/** What the Relay sends through Web Push. Never plaintext detail: the `sealed` part is ciphertext (invariant 9). */
export interface PushMessage {
  /** What the push is for. Generic on purpose. */
  t: "request" | "stop" | "idle" | "notify" | "info"
  id?: string
  /** Detail sealed to the phone's key. The service worker shows it only if the user turned lock-screen detail on. */
  sealed?: unknown
}

export type PushResult = "ok" | "gone" | "error"

export interface PushSender {
  publicKey(): string
  send(subscription: string, message: PushMessage, urgent: boolean): Promise<PushResult>
}

/** Web Push with VAPID keys made on first run and kept in the database volume. */
export class WebPushSender implements PushSender {
  readonly #pub: string
  readonly #priv: string
  readonly #subject: string

  constructor(store: Store, subject: string) {
    let keys = store.kvGet("vapid")
    if (!keys) {
      const k = webpush.generateVAPIDKeys()
      keys = JSON.stringify(k)
      store.kvSet("vapid", keys)
    }
    const parsed = JSON.parse(keys) as { publicKey: string; privateKey: string }
    this.#pub = parsed.publicKey
    this.#priv = parsed.privateKey
    this.#subject = subject
  }

  publicKey(): string {
    return this.#pub
  }

  async send(subscription: string, message: PushMessage, urgent: boolean): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        JSON.parse(subscription) as webpush.PushSubscription,
        JSON.stringify(message),
        {
          vapidDetails: { subject: this.#subject, publicKey: this.#pub, privateKey: this.#priv },
          TTL: urgent ? 600 : 3600,
          urgency: urgent ? "high" : "normal",
        },
      )
      return "ok"
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      return status === 404 || status === 410 ? "gone" : "error"
    }
  }
}
