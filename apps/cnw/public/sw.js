// Codehouse Neighbourhood Watch's service worker: shows a push as a notification (Web Push, for a closed tab or a
// locked phone), and opens the inbox when it is tapped. It caches nothing and runs no other code.
self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === "string" ? data.title : "Neighbourhood Watch"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "Something waits for you.",
      tag: typeof data.tag === "string" ? data.tag : "cnw",
      // The Codehouse mark, served with the interface at /app/.
      icon: "/app/favicon-32.png",
      // A path on this server only: "//elsewhere" would be another site.
      data: { url: typeof data.url === "string" && /^\/(?![/\\])/.test(data.url) ? data.url : "/#inbox" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? "/#inbox"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const t of tabs) if (new URL(t.url).origin === self.location.origin) return t.navigate(url).then((c) => c?.focus())
      return self.clients.openWindow(url)
    }),
  )
})
