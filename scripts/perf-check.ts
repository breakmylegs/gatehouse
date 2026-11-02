// W1-18: how the interface copes with a long session. Opens apps/web/screens.html?view=perf (one session with 10,000
// messages, no Host) in Edge without a window, through the DevTools protocol; records how long the page took to be
// ready, times every frame while scrolling, and reads the memory the page uses. Two kinds of scroll: a very fast
// continuous flick (400 pixels a frame, about 24,000 a second, up from the end), which must keep 98% of frames under
// 50 ms; and dragging the scroll bar end to end across all 10,000 messages in five seconds, which is reported only.
// Fails when the page uses 400 MB or more, or the flick drops more than 2% of frames.
//
// Usage: start the web dev server first (npx vite in apps/web), then
//   node node_modules/tsx/dist/cli.mjs scripts/perf-check.ts [http://localhost:5199] [--profile] [--runs N]
// --profile records a CPU profile of the flick and lists where the time went (build without minifying to read it).
// --runs repeats the flick and reports each run and the median, since one run on a busy computer says little.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? "http://localhost:5199"
const profiling = args.includes("--profile")
const runs = Math.max(1, Number(args[args.indexOf("--runs") + 1]) || 1)
const edge = ["ProgramFiles(x86)", "ProgramFiles"]
  .map((v) => path.join(process.env[v] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"))
  .find((p) => fs.existsSync(p))
if (!edge) throw new Error("Microsoft Edge was not found.")

const MAX_MB = 400
const MAX_SLOW_SHARE = 0.02
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-perf-"))
const browser = spawn(edge, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--window-size=1440,900",
  "about:blank",
])

/** Ends Edge and every process it started, then deletes its profile (see scripts/screenshots.ts). */
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
  console.warn(`[perf] could not remove ${profile}; delete it by hand`)
}

interface CpuProfile {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>
  samples: number[]
  timeDeltas: number[]
}

/** Prints the functions that took the most time themselves during the profile. */
function summarise(p: CpuProfile): void {
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const self = new Map<string, number>()
  let total = 0
  p.samples.forEach((id, i) => {
    const n = byId.get(id)
    const us = p.timeDeltas[i] ?? 0
    total += us
    if (!n) return
    const f = n.callFrame
    const key = `${f.functionName || "(anonymous)"} ${f.url ? path.basename(f.url.split("?")[0] ?? "") : ""}:${f.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + us)
  })
  console.log(`[perf] profile: ${Math.round(total / 1000)} ms sampled; most time spent in`)
  for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(
      `[perf]   ${(us / 1000).toFixed(0).padStart(6)} ms ${((us / total) * 100).toFixed(1).padStart(5)}%  ${k}`,
    )
}

let failed = false
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
  const evaluate = async <T>(expression: string): Promise<T> =>
    (
      await send<{ result: { value: T } }>("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value

  await send("Page.enable")
  await send("Performance.enable")
  const began = Date.now()
  await send("Page.navigate", { url: `${base}/screens.html?view=perf&theme=dark` })
  let ready = false
  for (let i = 0; i < 240 && !ready; i++) {
    await sleep(250)
    ready = (await evaluate<string | undefined>("document.body.dataset.ready")) === "1"
  }
  if (!ready) throw new Error("The long session did not finish loading")
  const readyMs = Date.now() - began
  await sleep(1500)

  // One scroll step a frame, timing every frame. flick: 400 px a frame up from the end; drag: end to start and back.
  const scroll = (kind: "flick" | "drag") =>
    evaluate<number[]>(`(async () => {
      const box = [...document.querySelectorAll('[data-virtuoso-scroller="true"]')][0]
      if (!box) return []
      const times = []
      let last = performance.now()
      const step = async () => new Promise((r) => requestAnimationFrame((t) => { times.push(t - last); last = t; r() }))
      box.scrollTop = box.scrollHeight
      await step(); await step()
      times.length = 0
      last = performance.now()
      const span = box.scrollHeight
      if ("${kind}" === "flick")
        for (let i = 0; i < 300; i++) { box.scrollTop -= 400; await step() }
      else
        for (let k = 0; k < 2; k++)
          for (let i = 0; i <= 150; i++) {
            box.scrollTop = k === 0 ? span - (span * i) / 150 : (span * i) / 150
            await step()
          }
      return times
    })()`)
  if (profiling) {
    await send("Profiler.enable")
    await send("Profiler.setSamplingInterval", { interval: 200 })
    await send("Profiler.start")
  }
  const shares: number[] = []
  let frames: number[] = []
  for (let r = 0; r < runs; r++) {
    frames = await scroll("flick")
    const slowRun = frames.filter((f) => f > 50).length
    shares.push(frames.length ? slowRun / frames.length : 1)
    if (runs > 1)
      console.log(`[perf] run ${r + 1}: ${slowRun} of ${frames.length} frames over 50 ms`)
  }
  if (profiling) summarise((await send<{ profile: CpuProfile }>("Profiler.stop")).profile)
  const drag = await scroll("drag")
  const metrics = await send<{ metrics: Array<{ name: string; value: number }> }>(
    "Performance.getMetrics",
  )
  const heap = metrics.metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0
  const nodes = metrics.metrics.find((m) => m.name === "Nodes")?.value ?? 0
  const mb = Math.round(heap / 1024 / 1024)
  const slow = frames.filter((f) => f > 50).length
  const share = [...shares].sort((a, b) => a - b)[Math.floor(shares.length / 2)] ?? 1
  if (runs > 1)
    console.log(`[perf] median of ${runs} runs: ${(share * 100).toFixed(1)}% of frames over 50 ms`)
  console.log(`[perf] ready in ${readyMs} ms with 10,000 messages`)
  console.log(`[perf] memory (JS heap) ${mb} MB, ${nodes} DOM nodes`)
  console.log(
    `[perf] flick: ${frames.length} frames, ${slow} over 50 ms (${(share * 100).toFixed(1)}%), slowest ${Math.round(Math.max(0, ...frames))} ms`,
  )
  const dragSlow = drag.filter((f) => f > 50).length
  console.log(
    `[perf] scroll bar drag (reported only): ${drag.length} frames, ${dragSlow} over 50 ms (${drag.length ? ((dragSlow / drag.length) * 100).toFixed(1) : "0"}%), slowest ${Math.round(Math.max(0, ...drag))} ms`,
  )
  if (frames.length === 0) {
    console.log("[perf] FAILED: the transcript could not be found to scroll")
    failed = true
  }
  if (mb >= MAX_MB) {
    console.log(`[perf] FAILED: ${mb} MB is over the ${MAX_MB} MB limit`)
    failed = true
  }
  if (share > MAX_SLOW_SHARE) {
    console.log(`[perf] FAILED: more than ${MAX_SLOW_SHARE * 100}% of frames were slow`)
    failed = true
  }
  ws.close()
} finally {
  await closeEdge()
}
console.log(failed ? "[perf] failed" : "[perf] passed")
process.exitCode = failed ? 1 : 0
