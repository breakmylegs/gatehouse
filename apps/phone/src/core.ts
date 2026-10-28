import { startAuthentication, startRegistration } from "@simplewebauthn/browser"
import {
  b64u,
  exportPublicKey,
  fingerprint,
  generateKeyPair,
  type Sealed,
} from "@gatehouse/shared/e2e"
import {
  newEnvelope,
  openRequest,
  signAndSeal,
  type OpenedRequest,
} from "@gatehouse/shared/phone-protocol"
import { storage, type DeviceInfo, type KeyMaterial } from "./storage"

/** Everything the phone does that is not drawing. Kept free of React so it can be tested and read on its own. */

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function call<T>(
  method: string,
  url: string,
  body?: unknown,
  bearer?: string,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new RelayError(0, "Could not reach JCVC. Check your connection and try again.")
  }
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    throw new RelayError(res.status, `The server answered ${res.status} with something unexpected.`)
  }
  if (!res.ok) {
    const m = (json as { error?: string } | undefined)?.error
    throw new RelayError(
      res.status,
      res.status === 404
        ? "Not found. Check the code and try again."
        : res.status === 429
          ? "Too many tries. Wait a minute and try again."
          : (m ?? `The server answered ${res.status}.`),
    )
  }
  return json as T
}

export const isStandalone = (): boolean =>
  (navigator as unknown as { standalone?: boolean }).standalone === true ||
  matchMedia("(display-mode: standalone)").matches
export const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent)

// ---- pairing ----

export interface PairProgress {
  pairingId: string
  fingerprint: string
  code: string
}

/** Steps 2 to 4 of pairing, on the phone. Returns the six digits to compare with the desktop. */
export async function register(
  code: string,
  phoneName: string,
  askForPush: boolean,
): Promise<
  PairProgress & {
    keys: KeyMaterial
    info: { rpId: string; origin: string; hostPublicKey: string }
  }
> {
  const clean = code.trim().toUpperCase()
  const info = await call<{
    pairingId: string
    challenge: string
    hostPublicKey: string
    rpId: string
    origin: string
  }>("GET", `/api/phone/pairing-info?code=${encodeURIComponent(clean)}`)
  const kp = await generateKeyPair(false)
  const keys: KeyMaterial = {
    privateKey: kp.privateKey,
    publicKey: await exportPublicKey(kp.publicKey),
  }
  const registration = await startRegistration({
    optionsJSON: {
      rp: { id: info.rpId, name: "Jean-Claude Van Code" },
      user: {
        id: b64u(crypto.getRandomValues(new Uint8Array(16))),
        name: "gatehouse",
        displayName: "Jean-Claude Van Code",
      },
      challenge: info.challenge,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 120_000,
      attestation: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
    },
  })
  const pushSubscription = askForPush ? await subscribePush().catch(() => undefined) : undefined
  await call("POST", `/api/phone/pairings/${info.pairingId}/register`, {
    code: clean,
    phoneName,
    ecdhPublicKey: keys.publicKey,
    registration,
    ...(pushSubscription ? { pushSubscription } : {}),
  })
  const fp = await fingerprint({
    hostPublicKey: info.hostPublicKey,
    phonePublicKey: keys.publicKey,
    credentialId: registration.id,
  })
  await storage.setKeys(keys)
  // The device record is written only when the desktop confirms, so an abandoned pairing leaves nothing usable behind.
  sessionStorage.setItem(
    "gatehouse.pairing",
    JSON.stringify({
      pairingId: info.pairingId,
      code: clean,
      credentialId: registration.id,
      name: phoneName,
      hostPublicKey: info.hostPublicKey,
      rpId: info.rpId,
      origin: info.origin,
    }),
  )
  return { pairingId: info.pairingId, fingerprint: fp, code: clean, keys, info }
}

/** Waits for the desktop to confirm the six digits. Resolves with the device record once it has. */
export async function awaitConfirmation(
  pairingId: string,
  code: string,
  signal: AbortSignal,
): Promise<DeviceInfo> {
  const saved = JSON.parse(sessionStorage.getItem("gatehouse.pairing") ?? "{}") as {
    credentialId: string
    name: string
    hostPublicKey: string
    rpId: string
    origin: string
  }
  while (!signal.aborted) {
    const s = await call<{ status: string; phoneId?: string }>(
      "GET",
      `/api/phone/pairings/${pairingId}/status?code=${encodeURIComponent(code)}`,
    )
    if (s.status === "confirmed" && s.phoneId) {
      const device: DeviceInfo = {
        phoneId: s.phoneId,
        hostPublicKey: saved.hostPublicKey,
        rpId: saved.rpId,
        origin: saved.origin,
        credentialId: saved.credentialId,
        name: saved.name,
      }
      await storage.setDevice(device)
      sessionStorage.removeItem("gatehouse.pairing")
      return device
    }
    if (s.status === "expired")
      throw new RelayError(410, "The code expired. Ask the desktop for a new one.")
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error("Cancelled")
}

// ---- push ----

export async function subscribePush(): Promise<{
  endpoint: string
  keys: { p256dh: string; auth: string }
}> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    throw new Error("Notifications are not available here")
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Notifications were not allowed")
  const reg = await navigator.serviceWorker.ready
  const cfg = await call<{ vapidPublicKey: string }>("GET", "/api/public/config")
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToBytes(cfg.vapidPublicKey),
  })
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  return { endpoint: j.endpoint, keys: j.keys }
}

const b64ToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)
  const bin = atob(t)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---- the session ----

export interface Session {
  token: string
  expiresAt: number
}

/** Face ID, through the passkey. The Relay checks the assertion before it gives out a session. */
export async function unlock(device: DeviceInfo): Promise<Session> {
  const options = await call<{
    challenge: string
    rpId: string
    allowCredentials?: Array<{ id: string }>
  }>("POST", "/api/phone/session/challenge", { phoneId: device.phoneId })
  const assertion = await startAuthentication({ optionsJSON: options as never })
  const s = await call<{ token: string; expiresAt: string }>("POST", "/api/phone/session", {
    phoneId: device.phoneId,
    assertion,
  })
  return { token: s.token, expiresAt: Date.parse(s.expiresAt) }
}

export interface PendingItem {
  relayId: string
  opened?: OpenedRequest
  error?: string
  expiresAt: string
  resolved?: { at: string; summary: string }
}

export async function loadPending(session: Session, keys: KeyMaterial): Promise<PendingItem[]> {
  const list = await call<
    Array<{ id: string; sealed: Sealed; expiresAt: string; resolvedAt?: string; summary?: string }>
  >("GET", "/api/phone/pending", undefined, session.token)
  const out: PendingItem[] = []
  for (const r of list) {
    const base: PendingItem = {
      relayId: r.id,
      expiresAt: r.expiresAt,
      ...(r.resolvedAt ? { resolved: { at: r.resolvedAt, summary: r.summary ?? "Decided" } } : {}),
    }
    try {
      out.push({ ...base, opened: await openRequest(r.sealed, keys.privateKey, r.id) })
    } catch {
      out.push({
        ...base,
        error:
          "This request could not be opened or did not match its checksum, so it cannot be answered here.",
      })
    }
  }
  return out
}

// ---- answering ----

const ttl = { decision: 5 * 60_000, kill: 60_000 }

function signWith(device: DeviceInfo) {
  return (challenge: string) =>
    startAuthentication({
      optionsJSON: {
        challenge,
        rpId: device.rpId,
        allowCredentials: [{ id: device.credentialId, type: "public-key" }],
        userVerification: "required",
        timeout: 60_000,
      },
    }) as unknown as Promise<Record<string, unknown>>
}

export async function answer(
  session: Session,
  device: DeviceInfo,
  item: PendingItem,
  what: { decision: "allow" | "deny"; message?: string } | { answers: Record<string, string> },
): Promise<void> {
  const o = item.opened
  if (!o) throw new Error("This request cannot be answered")
  if ("decision" in what && what.decision === "allow" && o.oversize)
    throw new Error("This request is too long to show here, so it can only be denied.")
  const envelope =
    "decision" in what
      ? newEnvelope({
          type: "decision",
          deviceId: device.phoneId,
          now: Date.now(),
          ttlMs: ttl.decision,
          requestId: o.payload.id,
          nonce: o.payload.nonce,
          payloadHash: o.payloadHash,
          decision: what.decision,
          ...(what.message ? { message: what.message } : {}),
        })
      : newEnvelope({
          type: "answer",
          deviceId: device.phoneId,
          now: Date.now(),
          ttlMs: ttl.decision,
          requestId: o.payload.id,
          nonce: o.payload.nonce,
          payloadHash: o.payloadHash,
          answers: what.answers,
        })
  const sealed = await signAndSeal(envelope, signWith(device), device.hostPublicKey, item.relayId)
  await call("POST", "/api/phone/envelopes", { requestId: item.relayId, sealed }, session.token)
}

export async function kill(session: Session, device: DeviceInfo): Promise<void> {
  const envelope = newEnvelope({
    type: "kill",
    deviceId: device.phoneId,
    now: Date.now(),
    ttlMs: ttl.kill,
  })
  const sealed = await signAndSeal(envelope, signWith(device), device.hostPublicKey, "kill")
  await call("POST", "/api/phone/envelopes", { sealed }, session.token)
}

export async function enableNotifications(session: Session): Promise<void> {
  const sub = await subscribePush()
  await call("PUT", "/api/phone/push-subscription", { subscription: sub }, session.token)
}
