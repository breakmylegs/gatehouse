// Saves the README pictures into docs/images: opens each view of apps/web/screens.html (realistic sample data, no
// Host) in Edge without a window, through the DevTools protocol, and captures it at 1440 x 900.
//
// Usage: start the web dev server first (the gatehouse-web-demo launch entry, or npx vite in apps/web), then
//   node node_modules/tsx/dist/cli.mjs scripts/screenshots.ts [http://localhost:5199]
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const base = process.argv[2] ?? "http://localhost:5199"
const out = path.join(root, "docs", "images")
const edge = ["ProgramFiles(x86)", "ProgramFiles"]
  .map((v) => path.join(process.env[v] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"))
  .find((p) => fs.existsSync(p))
if (!edge) throw new Error("Microsoft Edge was not found.")

const SHOTS = [
  { file: "approvals.png", view: "approvals", theme: "light" },
  { file: "approvals-dark.png", view: "approvals", theme: "dark" },
  { file: "workspace.png", view: "workspace", theme: "dark" },
  { file: "policy.png", view: "policy", theme: "light" },
  { file: "update.png", view: "update", theme: "light" },
  { file: "settings-updates.png", view: "settings", theme: "light" },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jcvc-shots-"))
const browser = spawn(edge, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--hide-scrollbars",
  "--window-size=1440,900",
  "about:blank",
])

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
    const m = JSON.parse(String(e.data)) as {
      id?: number
      result?: unknown
      error?: { message: string }
    }
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)?.(m.error ? Promise.reject(new Error(m.error.message)) : m.result)
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
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  fs.mkdirSync(out, { recursive: true })
  for (const s of SHOTS) {
    await send("Page.navigate", { url: `${base}/screens.html?view=${s.view}&theme=${s.theme}` })
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      await sleep(250)
      const r = await send<{ result: { value?: string } }>("Runtime.evaluate", {
        expression: "document.body.dataset.ready",
        returnByValue: true,
      })
      ready = r.result.value === "1"
    }
    if (!ready) throw new Error(`${s.view} did not finish loading`)
    // Let the pictures and the fonts settle, and any opening animation finish.
    await sleep(900)
    const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" })
    fs.writeFileSync(path.join(out, s.file), Buffer.from(shot.data, "base64"))
    console.log(`[screenshots] ${s.file}`)
  }
  ws.close()
} finally {
  browser.kill()
  await sleep(500)
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    // Edge can hold its profile for a moment after it closes; it is only a temporary folder.
  }
}
