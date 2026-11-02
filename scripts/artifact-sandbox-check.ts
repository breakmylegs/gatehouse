// Checks the artifact sandbox for real, in headless Edge (owner's plan, W1-09, ADR 0003). An artifact is served with the
// headers the Host uses and shown in a frame like the window's, and its page tries every way out it can: fetch, XHR,
// a WebSocket, an image, a form post, top-level navigation, a pop-up, and reading storage. A decoy server counts any
// request that reaches it. Every attempt must fail and the decoy must see nothing.
//
// Usage: node node_modules/tsx/dist/cli.mjs scripts/artifact-sandbox-check.ts
// Run it after changing artifactHeaders, the artifact route or the frame, and before a release that does.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
// The headers come from the Host's own code. A copy can be named for trying a weakened version (the break check does
// this, so the real file is never edited): ARTIFACTS_MODULE=<path to a copy>.
const { artifactHeaders } = (await import(
  process.env.ARTIFACTS_MODULE
    ? new URL(`file:///${process.env.ARTIFACTS_MODULE.replaceAll("\\", "/")}`).href
    : "../apps/host/src/artifacts.ts"
)) as typeof import("../apps/host/src/artifacts.ts")

const edge = ["ProgramFiles(x86)", "ProgramFiles"]
  .map((v) => path.join(process.env[v] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"))
  .find((p) => fs.existsSync(p))
if (!edge) throw new Error("Microsoft Edge was not found.")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
  )

// Anything that reaches this server got out of the sandbox.
const hits: string[] = []
const decoy = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`)
  res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain" })
  res.end("you should not see this")
})
const decoyPort = await listen(decoy)
const D = `http://127.0.0.1:${decoyPort}`

let windowPort = 0
let artifactPort = 0
const A = () => `http://127.0.0.1:${artifactPort}`

// What a hostile artifact does. Each attempt reports how it ended to the window, which keeps the list.
const artifactPage = `<!doctype html><meta charset="utf-8"><body><script>
const tell = (name, outcome) => parent.postMessage({ name, outcome }, "*")
const attempt = async (name, fn) => {
  try { tell(name, await fn()) } catch (e) { tell(name, "failed: " + (e && e.name || e)) }
}
tell("scripts run", "yes")
attempt("fetch the decoy", () => fetch("${D}/fetch").then(() => "reached", () => "failed"))
attempt("fetch the artifact's own origin", () => fetch(location.href).then(() => "reached", () => "failed"))
attempt("XMLHttpRequest the decoy", () => new Promise((r) => {
  const x = new XMLHttpRequest(); x.open("GET", "${D}/xhr")
  x.onload = () => r("reached"); x.onerror = () => r("failed"); x.send()
}))
attempt("open a WebSocket", () => new Promise((r) => {
  const w = new WebSocket("ws://127.0.0.1:${decoyPort}/ws")
  w.onopen = () => r("reached"); w.onerror = () => r("failed")
}))
attempt("load an image from the decoy", () => new Promise((r) => {
  const i = new Image(); i.onload = () => r("reached"); i.onerror = () => r("failed"); i.src = "${D}/image.png"
}))
attempt("post a form", () => { const f = document.createElement("form"); f.method = "post"; f.action = "${D}/form"
  document.body.append(f); f.submit(); return "submitted (the decoy must not see it)" })
attempt("navigate the top window", () => { top.location.href = "${D}/top"; return "assigned" })
attempt("open a pop-up", () => { const w = window.open("${D}/popup"); return w ? "opened" : "blocked" })
attempt("read cookies", () => document.cookie === "" ? "empty" : "has cookies")
attempt("read localStorage", () => String(localStorage.length))
attempt("read the parent's page", () => parent.document.title)
const go = document.createElement("button")
go.textContent = "click"
go.style.cssText = "position:fixed;inset:0;width:100%;height:100%"
document.body.append(go)
tell("ready for a click", "yes")
go.onclick = () => {
  attempt("open a pop-up after a click", () => { const w = window.open("${D}/popup-click"); return w ? "opened" : "blocked" })
  attempt("navigate the top window after a click", () => { top.location.href = "${D}/top-click"; return "assigned" })
}
</script></body>`

const artifact = http.createServer((req, res) => {
  const headers = artifactHeaders(`http://127.0.0.1:${windowPort}`, "html")
  res.writeHead(200, headers)
  res.end(artifactPage)
})
artifactPort = await listen(artifact)

// The window frames the artifact. In the first scenario as the app does, with the frame's own sandbox attribute; in the
// second with no attribute at all, so the response's own headers have to hold on their own (two layers, each enough).
const windowPage = (
  attr: boolean,
) => `<!doctype html><meta charset="utf-8"><title>window</title><body>
<iframe id="f" src="${A()}/a" ${attr ? 'sandbox="allow-scripts"' : ""} referrerpolicy="no-referrer"></iframe>
<script>
window.__results = {}
addEventListener("message", (e) => { if (e.data && e.data.name) window.__results[e.data.name] = e.data.outcome })
</script></body>`
const win = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" })
  res.end(windowPage(req.url?.startsWith("/attr") ?? true))
})
windowPort = await listen(win)

const port = 9300 + Math.floor(Math.random() * 500)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-sandbox-"))
const browser = spawn(edge, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "about:blank",
])

/**
 * Ends Edge and every process it started, then deletes its profile. Killing only the first process left the others
 * running and holding the folder, so each run leaked a profile of up to 900 MB in %TEMP% (owner, 1 Nov).
 */
async function closeEdge(): Promise<void> {
  if (browser.pid)
    spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" })
  else browser.kill()
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true })
      return
    } catch {
      await sleep(500)
    }
  }
  console.warn(`[sandbox] could not remove ${profile}; delete it by hand`)
}
let failures = 0
try {
  let pageWs: string | undefined
  for (let i = 0; i < 60 && !pageWs; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string
        webSocketDebuggerUrl: string
      }>
      pageWs = list.find((t) => t.type === "page")?.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    if (!pageWs) await sleep(250)
  }
  if (!pageWs) throw new Error("Edge did not start its DevTools endpoint.")
  const ws = new WebSocket(pageWs)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = j
  })
  let next = 1
  const waiting = new Map<number, (v: unknown) => void>()
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown }
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)?.(m.result)
      waiting.delete(m.id)
    }
  }
  const send = <T>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve) => {
      const id = next++
      waiting.set(id, resolve as (v: unknown) => void)
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send("Page.enable")
  for (const [label, route] of [
    ["framed as the window frames it (header and frame attribute)", "/attr"],
    ["the header alone (a frame with no sandbox attribute)", "/header"],
  ] as const) {
    console.log(`[sandbox] ${label}`)
    hits.length = 0
    await send("Page.navigate", { url: `http://127.0.0.1:${windowPort}${route}` })
    // Wait for the artifact to finish its attempts.
    let results: Record<string, string> = {}
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      const r = await send<{ result: { value?: string } }>("Runtime.evaluate", {
        expression: "JSON.stringify(window.__results || {})",
        returnByValue: true,
      })
      results = JSON.parse(r.result.value ?? "{}") as Record<string, string>
      if (results["ready for a click"] === "yes" && Object.keys(results).length >= 13) break
    }
    // Click inside the artifact, as a person would, and give the clicked attempts time to land.
    const rect = await send<{ result: { value?: string } }>("Runtime.evaluate", {
      expression: "JSON.stringify(document.getElementById('f').getBoundingClientRect())",
      returnByValue: true,
    })
    const box = JSON.parse(rect.result.value ?? "{}") as {
      x: number
      y: number
      width: number
      height: number
    }
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 })
    await sleep(2000)
    for (let i = 0; i < 10; i++) {
      const r = await send<{ result: { value?: string } }>("Runtime.evaluate", {
        expression: "JSON.stringify(window.__results || {})",
        returnByValue: true,
      })
      const now = JSON.parse(r.result.value ?? "null") as Record<string, string> | null
      if (now) results = now
      if (
        results["open a pop-up after a click"] &&
        results["navigate the top window after a click"]
      )
        break
      await sleep(300)
    }
    const href = await send<{ result: { value?: string } }>("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    })

    const check = (name: string, ok: boolean, detail: string) => {
      console.log(`[sandbox] ${ok ? "ok  " : "FAIL"} ${name}: ${detail}`)
      if (!ok) failures++
    }
    check(
      "scripts of its own run",
      results["scripts run"] === "yes",
      String(results["scripts run"]),
    )
    for (const name of [
      "fetch the decoy",
      "fetch the artifact's own origin",
      "XMLHttpRequest the decoy",
      "open a WebSocket",
      "load an image from the decoy",
    ])
      check(name, results[name] === "failed", String(results[name]))
    check("open a pop-up", results["open a pop-up"] === "blocked", String(results["open a pop-up"]))
    check(
      "navigate the top window",
      String(results["navigate the top window"]).startsWith("failed") &&
        href.result.value === `http://127.0.0.1:${windowPort}${route}`,
      `${results["navigate the top window"]}; window is still at ${href.result.value}`,
    )
    check(
      "read cookies",
      String(results["read cookies"]).startsWith("failed"),
      String(results["read cookies"]),
    )
    check(
      "read localStorage",
      String(results["read localStorage"]).startsWith("failed"),
      String(results["read localStorage"]),
    )
    check(
      "read the parent's page",
      String(results["read the parent's page"]).startsWith("failed"),
      String(results["read the parent's page"]),
    )
    check("a form post", results["post a form"] !== undefined, String(results["post a form"]))
    check(
      "open a pop-up after a click",
      results["open a pop-up after a click"] === "blocked",
      String(results["open a pop-up after a click"]),
    )
    check(
      "navigate the top window after a click",
      String(results["navigate the top window after a click"]).startsWith("failed") &&
        href.result.value === `http://127.0.0.1:${windowPort}${route}`,
      `${results["navigate the top window after a click"]}; window is still at ${href.result.value}`,
    )
    // The decoy is the proof: anything that reached it got out.
    check(
      "the decoy saw nothing",
      hits.length === 0,
      hits.length ? hits.join(", ") : "no request reached it",
    )
  }
  ws.close()
} finally {
  decoy.close()
  artifact.close()
  win.close()
  await closeEdge()
}
console.log(failures ? `[sandbox] ${failures} check(s) failed` : "[sandbox] every way out was shut")
process.exit(failures ? 1 : 0)
