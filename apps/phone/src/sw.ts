/// <reference lib="webworker" />
import { openJson } from "@gatehouse/shared/e2e"
import { GENERIC_PUSH } from "@gatehouse/shared/relay-protocol"
import { storage } from "./storage"

declare const self: ServiceWorkerGlobalScope

/**
 * Shows a push. The text is generic ("Approval needed") unless the user turned lock-screen detail on, in which
 * case the sealed summary is decrypted here with the phone's own key (invariant 9). The push itself never
 * carries plaintext detail. iOS requires every push to show something, so this always does.
 */
interface Push {
  t?: keyof typeof GENERIC_PUSH
  id?: string
  sealed?: unknown
}

async function show(event: PushEvent): Promise<void> {
  let msg: Push = {}
  try {
    msg = (event.data?.json() ?? {}) as Push
  } catch {
    /* an unreadable push still shows the generic text */
  }
  const kind = msg.t && msg.t in GENERIC_PUSH ? msg.t : "info"
  let title: string = GENERIC_PUSH[kind]
  let body = ""
  try {
    const settings = await storage.settings()
    const keys = await storage.keys()
    if (settings.lockScreenDetail && keys && msg.sealed) {
      const d = await openJson<{ title?: string; body?: string }>(
        msg.sealed as never,
        keys.privateKey,
        "push",
      )
      if (typeof d.title === "string" && d.title) title = d.title
      if (typeof d.body === "string") body = d.body
    }
  } catch {
    /* if the detail cannot be read, the generic text stands */
  }
  await self.registration.showNotification(title, {
    body,
    tag: msg.id ?? kind,
    icon: "/icon-192.png",
    data: { id: msg.id },
  })
  new BroadcastChannel("gatehouse").postMessage({ t: "refresh" })
}

self.addEventListener("install", () => void self.skipWaiting())
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()))
self.addEventListener("push", (e) => e.waitUntil(show(e)))
self.addEventListener("notificationclick", (e) => {
  e.notification.close()
  const id = (e.notification.data as { id?: string } | undefined)?.id
  const url = id ? `/#/r/${encodeURIComponent(id)}` : "/"
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const open = all[0]
      if (open) {
        await open.focus()
        if ("navigate" in open) await (open as WindowClient).navigate(url).catch(() => undefined)
      } else await self.clients.openWindow(url)
    })(),
  )
})
