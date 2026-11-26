// @vitest-environment node
// O55 (owner, 25 Nov): the phone layout in a real browser. The demo screens (screens.html, sample data, no Host) open
// in Edge (or Chrome on a Mac) without a window, as a phone with a finger for a pointer, at 360x800, 390x844 and
// 430x932, upright and on its side, in light, dark and forced colours (high contrast). On every screen: the phone
// layout is on, nothing scrolls sideways or runs off the side, no sidebar or side column is drawn, every visible button
// is at least 44 px each way, and the tab bar and the page keep clear of the safe areas. The styles it checks are
// apps/web/src/phone.css, styles.css, mac-standard.css and mac.css, so the gate runs it when one of them changes.
// It skips where neither browser is installed.
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const browserPath = [
  ...["ProgramFiles(x86)", "ProgramFiles"].map((v) =>
    path.join(process.env[v] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ),
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p))

const SIZES = [
  [360, 800],
  [390, 844],
  [430, 932],
] as const
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Cdp = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

/** What the page finds wrong with itself at this size, as plain sentences. */
const PROBE = String.raw`(() => {
  const out = []
  const W = innerWidth, H = innerHeight
  const root = document.documentElement
  if (root.dataset.layout !== "phone") out.push("the phone layout is off")
  if (root.scrollWidth > W + 1) out.push("the page scrolls sideways: " + root.scrollWidth + " > " + W)
  if (document.body.scrollWidth > W + 1) out.push("the body scrolls sideways: " + document.body.scrollWidth)
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01
  }
  const name = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "") + (el.getAttribute("aria-label") ? "[" + el.getAttribute("aria-label") + "]" : "") + " " + (el.textContent || "").trim().slice(0, 30))
  // Inside a box that scrolls on its own (code, a table, the terminal) or is cut off, an element is not the page's.
  const boxed = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o !== "visible") return p
    }
    return null
  }
  const allowed = (el) => el.closest("pre, table, .term-out, code, [data-scroll-x], .virtuoso-scroller, [data-test-id=virtuoso-scroller]")
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el) || el.closest("svg") !== null && el.tagName.toLowerCase() !== "svg") continue
    const cs = getComputedStyle(el)
    // A box of its own that scrolls sideways, other than code, tables and the terminal.
    if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1 && !allowed(el))
      out.push("scrolls sideways: " + name(el) + " (" + el.scrollWidth + " > " + el.clientWidth + ")")
    // Something running off the side of the screen.
    const r = el.getBoundingClientRect()
    if ((r.right > W + 1 || r.left < -1) && cs.position !== "fixed" && !allowed(el)) {
      const b = boxed(el)
      const br = b ? b.getBoundingClientRect() : null
      if (!br || br.right > W + 1 || br.left < -1) out.push("runs off the side: " + name(el) + " (" + Math.round(r.left) + " to " + Math.round(r.right) + ")")
    }
  }
  // The desktop's sidebar, its resizer, the help column and side panels: never on a phone.
  for (const sel of [".rail", ".rail-resizer", ".show-rail", ".section-pills", "aside.help-pane"])
    for (const el of document.querySelectorAll(sel)) if (shown(el)) out.push("desktop part shown: " + sel)
  for (const el of document.querySelectorAll(".pane-rail"))
    if (shown(el) && getComputedStyle(el).position !== "fixed") out.push("a side column is drawn: " + name(el))
  const panes = [...document.querySelectorAll(".pane-slot")].filter(shown)
  if (panes.length > 1) out.push(panes.length + " panes side by side")
  // Buttons a thumb can hit: 44 px each way (inline links in prose are not buttons).
  for (const el of document.querySelectorAll("button, [role=button], a.btn, [role=tab], [role=menuitem], select, summary")) {
    if (!shown(el) || el.closest("[aria-hidden=true], .sr-only, .reply")) continue
    const r = el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > H) continue
    if (r.height < 43.5 || r.width < 43.5) out.push("too small to tap (" + Math.round(r.width) + "x" + Math.round(r.height) + "): " + name(el))
    // A label squeezed until its words break letter by letter.
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
    if ((el.textContent || "").trim().length > 2 && r.height > lh * 3.2 && r.width < 80) out.push("label squashed (" + Math.round(r.width) + "x" + Math.round(r.height) + "): " + name(el))
  }
  // The safe areas: the tab bar clear of the home indicator, the page clear of the notch.
  const tabs = document.querySelector(".phone-tabs")
  const inset = Number(getComputedStyle(root).getPropertyValue("--test-inset") || 0)
  if (tabs && shown(tabs) && inset) {
    const pad = parseFloat(getComputedStyle(tabs).paddingBottom)
    if (pad < inset) out.push("the tab bar sits on the home indicator: " + pad)
  }
  return [...new Set(out)]
})()`

describe.skipIf(!browserPath)("the phone layout in a browser (O55)", () => {
  let vite: { close: () => Promise<void>; url: string } | undefined
  let browser: ChildProcess | undefined
  let profile = ""
  let cdp: Cdp

  beforeAll(async () => {
    const { createServer } = await import("vite")
    const server = await createServer({
      configFile: path.join(web, "vite.config.ts"),
      root: web,
      logLevel: "silent",
      // The demo page's dependencies found from it before the browser opens, not discovered as each screen loads.
      optimizeDeps: { entries: ["screens.html"] },
      server: { host: "127.0.0.1", port: 9800 + Math.floor(Math.random() * 150), strictPort: false },
    })
    await server.listen()
    vite = { close: () => server.close(), url: server.resolvedUrls?.local[0] ?? "" }
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-phone-"))
    const port = 9400 + Math.floor(Math.random() * 400)
    browser = spawn(
      browserPath!,
      ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"],
      { stdio: "ignore", detached: process.platform !== "win32" },
    )
    let ws: string | undefined
    for (let i = 0; i < 80 && !ws; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
        ws = list.find((t) => t.type === "page")?.webSocketDebuggerUrl
      } catch {
        // not up yet
      }
      if (!ws) await sleep(250)
    }
    if (!ws) throw new Error("the browser did not start its DevTools endpoint")
    const sock = new WebSocket(ws)
    await new Promise((r, j) => {
      sock.onopen = r
      sock.onerror = j
    })
    let next = 1
    const waiting = new Map<number, { ok: (v: unknown) => void; no: (e: Error) => void }>()
    sock.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string } }
      const w = m.id ? waiting.get(m.id) : undefined
      if (!w) return
      waiting.delete(m.id!)
      if (m.error) w.no(new Error(m.error.message))
      else w.ok(m.result)
    }
    // A call the browser never answers (a page stuck in a loop) fails in 20 seconds with its name, not at the time limit.
    cdp = <T,>(method: string, params: Record<string, unknown> = {}) =>
      new Promise<T>((ok, no) => {
        const id = next++
        const timer = setTimeout(() => {
          waiting.delete(id)
          no(new Error(`the browser did not answer ${method} in 20 seconds`))
        }, 20_000)
        waiting.set(id, { ok: (v) => (clearTimeout(timer), (ok as (v: unknown) => void)(v)), no: (e) => (clearTimeout(timer), no(e)) })
        sock.send(JSON.stringify({ id, method, params }))
      })
    await cdp("Page.enable")
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
  }, 120_000)

  afterAll(async () => {
    if (browser?.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" })
      else {
        try {
          process.kill(-browser.pid, "SIGKILL")
        } catch {
          browser.kill("SIGKILL")
        }
      }
    }
    await vite?.close()
    for (let i = 0; i < 20 && profile; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await sleep(300)
      }
    }
  })

  const value = async <T,>(expression: string): Promise<T> =>
    (await cdp<{ result: { value: T } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value
  const size = async (w: number, h: number) => {
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: true })
    await sleep(350)
  }
  const open = async (view: string, theme: "light" | "dark", w: number, h: number) => {
    // A blank page first, so nothing the last screen left running holds this one up.
    await cdp("Page.navigate", { url: "about:blank" })
    await sleep(200)
    await size(w, h)
    await cdp("Page.navigate", { url: `${vite!.url}screens.html?view=${view}&theme=${theme}&n=${Math.random()}` })
    // Up to a minute: the first page from a cold dev server is compiled as it loads.
    for (let i = 0; i < 240; i++) {
      await sleep(250)
      // Ready, and the page's parts loaded (a lazy page says Loading… until it is).
      if (
        (await value<string | undefined>("document.body && document.body.dataset.ready")) === "1" &&
        !(await value<boolean>('(document.querySelector("main")?.textContent ?? "").includes("Loading…")'))
      )
        return sleep(300)
    }
    throw new Error(`${view} did not finish loading`)
  }
  const clickNow = (selector: string, text?: string) =>
    value<boolean>(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : "true"}); if (!el) return false; el.click(); return true })()`,
    )
  // CODEH_PHONE_SHOTS=<folder> keeps a picture of each screen at 390x844, to look at by eye.
  const shoot = async (name: string) => {
    const dir = process.env.CODEH_PHONE_SHOTS
    if (!dir) return
    await sleep(400)
    const shot = await cdp<{ data: string }>("Page.captureScreenshot", { format: "png" })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(shot.data, "base64"))
  }
  /** Waits for the button (a page loads its parts as it needs them), then clicks it; fails if it never comes. */
  const click = async (selector: string, text?: string) => {
    for (let i = 0; i < 60; i++) {
      if (await clickNow(selector, text)) return sleep(500)
      await sleep(250)
    }
    throw new Error(`nothing to click: ${selector} ${text ?? ""}`)
  }
  /** Every size, upright and on its side, with what is wrong at each. */
  const everySize = async (holds?: string) => {
    const found: string[] = []
    for (const [w, h] of SIZES)
      for (const [x, y] of [
        [w, h],
        [h, w],
      ] as const) {
        await size(x, y)
        await sleep(150)
        for (const p of await value<string[]>(PROBE)) found.push(`${x}x${y}: ${p}`)
        if (holds && !(await value<boolean>(holds))) found.push(`${x}x${y}: not as it should be: ${holds}`)
      }
    return found
  }

  const SCREENS: { view: string; label: string; then?: () => Promise<void>; holds?: string }[] = [
    { view: "approvals", label: "the requests waiting" },
    { view: "approvals", label: "a request opened", then: async () => void (await click(".board-row")) },
    { view: "sessions", label: "the session list" },
    { view: "workspace", label: "a session, chosen in two panes on a computer" },
    {
      view: "workspace-one",
      label: "a session with Changes open",
      then: async () => {
        await click(".phone-panels-btn")
        await click(".phone-sheet .pane-tool", "Changes")
      },
      // Changes is a sheet up from the foot, over the transcript, the full width of the screen.
      holds: `(() => { const r = document.querySelector(".pane-rail"); if (!r) return false; const b = r.getBoundingClientRect(); return getComputedStyle(r).position === "fixed" && Math.abs(b.bottom - innerHeight) < 2 && b.width >= innerWidth - 2 && b.height > innerHeight * 0.5 })()`,
    },
    { view: "more", label: "More" },
    { view: "policy", label: "a page for a computer" },
    { view: "dashboard", label: "the dashboard" },
    { view: "usage", label: "usage" },
  ]

  for (const theme of ["light", "dark"] as const)
    for (const s of SCREENS)
      it(`${s.label}, ${theme}${theme === "light" ? " and high contrast" : ""}: one column, nothing sideways, big targets`, async () => {
        await open(s.view, theme, 390, 844)
        await s.then?.()
        await shoot(`${s.view}-${s.label.replace(/[^a-z0-9]+/gi, "-")}-${theme}`)
        const found = await everySize(s.holds)
        if (theme === "light") {
          await cdp("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] })
          found.push(...(await everySize(s.holds)).map((f) => `forced colours, ${f}`))
          await cdp("Emulation.setEmulatedMedia", { features: [] })
        }
        expect(found).toEqual([])
      }, 120_000)

  it("keeps the tab bar off the home indicator", async () => {
    await open("approvals", "light", 390, 844)
    // A stand-in for the home indicator's inset: what env(safe-area-inset-bottom) gives on an iPhone.
    await value(`(() => { document.documentElement.style.setProperty("--safe-bottom", "34px"); document.documentElement.style.setProperty("--test-inset", "34"); return true })()`)
    expect(await value<string[]>(PROBE)).toEqual([])
    const pad = await value<number>(`parseFloat(getComputedStyle(document.querySelector(".phone-tabs")).paddingBottom)`)
    expect(pad).toBeGreaterThanOrEqual(34)
  }, 60_000)

  it("leaves a computer's window as it was: the sidebar, no tab bar", async () => {
    await open("approvals", "light", 1280, 800)
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: false })
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    expect(
      await value<{ layout: string | null; rail: boolean; tabs: boolean }>(
        `({ layout: document.documentElement.dataset.layout ?? null, rail: !!document.querySelector(".rail"), tabs: !!document.querySelector(".phone-tabs") })`,
      ),
    ).toEqual({ layout: null, rail: true, tabs: false })
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
  }, 60_000)
})
