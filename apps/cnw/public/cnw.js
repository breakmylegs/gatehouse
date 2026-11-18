// Codehouse Neighbourhood Watch's own pages (O41; the uplift, apps/cnw/DESIGN.md): first start, sign-in (an email and
// a password, passkeys where the address allows), then four places: Board (every computer and what waits on it),
// Inbox (every waiting request across computers), Server (CNW's own settings) and You (your sign-in, notifications).
// Opening a computer is the full Codehouse interface at /app/?computer=<id>. All text is set with textContent, never
// as HTML.
const main = document.getElementById("main")
const signout = document.getElementById("signout")
const tabs = document.getElementById("tabs")
const needs = document.getElementById("needs")
const inboxCount = document.getElementById("inbox-count")
const toastBox = document.getElementById("toast")
let csrf = ""
let me = {}
let board = { board: [], inbox: [] }
let seen = undefined
let poll = 0

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k === "text") e.textContent = v
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? "" : v)
  }
  for (const k of kids) if (k) e.append(k)
  return e
}

async function call(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, json }
}

function form(title, fields, submit, onSubmit, note) {
  const err = el("p", { class: "err", role: "alert" })
  const f = el("form", { class: "panel" }, el("h1", { text: title }), note ? el("p", { class: "muted", text: note }) : null)
  const inputs = {}
  for (const [name, label, type, extra] of fields) {
    const i = el("input", { name, type, required: true, ...(extra ?? {}) })
    inputs[name] = i
    f.append(el("label", {}, el("span", { text: label }), i))
  }
  f.append(err, el("button", { class: "btn primary", type: "submit", text: submit }))
  f.addEventListener("submit", async (e) => {
    e.preventDefault()
    err.textContent = ""
    const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))
    const msg = await onSubmit(values)
    if (msg) err.textContent = msg
  })
  return f
}

const canNotify = () => typeof Notification !== "undefined"

/** Dates as people here write them: 18 Nov 2026, 20:38. */
const when = (iso) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" })

/** A browser's own long name, as a person would say it: "Edge on Windows", "Safari on iPhone". */
function deviceName(ua) {
  if (!ua) return "A browser"
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "a Mac" : /Linux/.test(ua) ? "Linux" : ""
  const app = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ""
  return app && os ? `${app} on ${os}` : app || os || "A browser"
}

/**
 * The danger notice (apps/cnw/DESIGN.md): what a change breaks, before it breaks it. A modal dialog, Cancel the default
 * and first, Escape cancels, the confirm in a risk outline. Resolves to true only when confirmed. With fields, it
 * resolves to their values, or undefined when cancelled.
 */
function ask(title, text, confirmLabel, fields = []) {
  return new Promise((resolve) => {
    const d = el("dialog", { class: "sheet", "aria-labelledby": "ask-h" })
    const inputs = fields.map(([name, label, value]) => [name, el("input", { name, value: value ?? "", "aria-label": label })])
    const cancel = el("button", { class: "btn", type: "button", text: "Cancel" })
    const ok = el("button", { class: `btn ${fields.length ? "primary" : "danger"}`, type: "button", text: confirmLabel })
    const done = (v) => {
      d.close()
      d.remove()
      resolve(v)
    }
    cancel.addEventListener("click", () => done(fields.length ? undefined : false))
    ok.addEventListener("click", () => done(fields.length ? Object.fromEntries(inputs.map(([n, i]) => [n, i.value])) : true))
    d.addEventListener("cancel", (e) => {
      e.preventDefault()
      done(fields.length ? undefined : false)
    })
    d.append(
      el("h2", { id: "ask-h", text: title }),
      text ? el("p", { text }) : null,
      ...inputs.map(([, i], k) => el("label", {}, el("span", { text: fields[k][1] }), i)),
      el("div", { class: "row-actions" }, cancel, ok),
    )
    document.body.append(d)
    d.showModal()
    ;(inputs[0]?.[1] ?? cancel).focus()
  })
}

// A toast for what happened elsewhere: one at a time, announced politely, never the only record.
let toastTimer = 0
function toast(text) {
  toastBox.textContent = text
  toastBox.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastBox.hidden = true), 6000)
}

// Passkeys through the browser's own WebAuthn JSON support (Edge, Chrome, Safari 18 and later).
const canPasskey = () => typeof PublicKeyCredential !== "undefined" && typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function"

async function passkeySignIn() {
  const o = await call("POST", "/api/passkey/login/options")
  if (!o.ok) return o.json.error ?? "Passkeys are not available."
  try {
    const cred = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(o.json.options) })
    const v = await call("POST", "/api/passkey/login/verify", { ticket: o.json.ticket, response: cred.toJSON() })
    if (!v.ok) return v.json.error ?? "That did not work."
    render()
  } catch {
    return "No passkey was used."
  }
}

async function passkeyAdd(say) {
  const o = await call("POST", "/api/passkey/register/options")
  if (!o.ok) return void (say.textContent = o.json.error ?? "Not available.")
  try {
    const cred = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(o.json.options) })
    const v = await call("POST", "/api/passkey/register/verify", { ticket: o.json.ticket, response: cred.toJSON() })
    say.textContent = v.ok ? "Passkey added. Next time, sign in with it." : v.json.error ?? "It was not added."
  } catch {
    say.textContent = "No passkey was made."
  }
}

// Why passkeys are not offered here (CNW at an IP address), or "" when they are.
let passkeysOff = ""

const signedOutShell = () => {
  // The roadhouse picture, faintly, behind the pages before sign-in only (apps/cnw/DESIGN.md).
  document.body.classList.add("out")
  tabs.hidden = true
  needs.hidden = true
  signout.hidden = true
  main.className = "signin"
  clearInterval(poll)
}

async function render() {
  me = (await call("GET", "/api/me")).json
  passkeysOff = me.passkeys === false ? (me.passkeyNote ?? "Passkeys are not available here.") : ""
  main.replaceChildren()
  if (me.access === "user") {
    csrf = me.csrf
    sessionStorage.setItem("cnw.csrf", me.csrf)
  }
  if (me.setup) {
    signedOutShell()
    return main.append(
      form(
        "Set up Neighbourhood Watch",
        [
          ["code", "Setup code (printed once in the server's log)", "text", { autocomplete: "off" }],
          ["email", "Your email (you sign in with it)", "email", { autocomplete: "username", inputmode: "email" }],
          ["password", "A password of 12 characters or more", "password", { autocomplete: "new-password", minlength: "12" }],
        ],
        "Set up",
        async (v) => {
          const r = await call("POST", "/api/setup", v)
          if (!r.ok) return r.json.error ?? "That did not work."
          render()
        },
        "The first account needs the code from `docker compose logs cnw`, so nobody who finds this page first can claim it.",
      ),
    )
  }
  const invite = /^#invite=([A-Za-z0-9_-]{10,100})$/.exec(location.hash)
  if (invite && me.access !== "user") {
    signedOutShell()
    return main.append(
      form(
        "Join Neighbourhood Watch",
        [["password", "Choose a password of 12 characters or more", "password", { autocomplete: "new-password", minlength: "12" }]],
        "Join",
        async (v) => {
          const r = await call("POST", "/api/invite/accept", { token: invite[1], password: v.password })
          if (!r.ok) return r.json.error ?? "That did not work."
          history.replaceState(null, "", "#board")
          render()
        },
        "You were invited to Codehouse Neighbourhood Watch. You sign in with the email the invite was sent for.",
      ),
    )
  }
  if (me.access === "none") {
    signedOutShell()
    if (canPasskey() && !passkeysOff) {
      const err = el("p", { class: "err", role: "alert" })
      main.append(
        el(
          "section",
          { class: "panel" },
          el("h2", { text: "Sign in with a passkey" }),
          el("button", { class: "btn primary", text: "Use a passkey", onclick: async () => (err.textContent = (await passkeySignIn()) ?? "") }),
          err,
        ),
      )
    }
    return main.append(
      form(
        "Sign in",
        [
          // Text, not email: an account from before email sign-in still signs in once with its name.
          ["login", "Email", "text", { autocomplete: "username webauthn", inputmode: "email", autocapitalize: "none", spellcheck: "false" }],
          ["password", "Password", "password", { autocomplete: "current-password" }],
        ],
        "Sign in",
        async (v) => {
          const r = await call("POST", "/api/login", v)
          if (!r.ok) return r.json.error ?? "That did not work."
          if (r.json.totp) return void codeStep(r.json.ticket)
          render()
        },
        "Signed in with a name before? Use your name once: CNW then asks for your email, and keeps your password.",
      ),
    )
  }
  // Uplift phase 2: an account from before email sign-in adds its email, once, before anything else.
  if (me.needsEmail) {
    signedOutShell()
    signout.hidden = false
    return main.append(
      form(
        "Add your email",
        [["email", "Your email", "email", { autocomplete: "email", inputmode: "email" }]],
        "Save and carry on",
        async (v) => {
          const r = await call("POST", "/api/account/email", v)
          if (!r.ok) return r.json.error ?? "That did not work."
          render()
        },
        `From now on you sign in with your email instead of the name ${me.user}. Your password and passkeys stay as they are.`,
      ),
    )
  }
  // Signed in, or on an allowed network: the four places.
  document.body.classList.remove("out")
  tabs.hidden = false
  needs.hidden = false
  signout.hidden = me.access !== "user"
  main.className = "signed-in"
  await refresh(false)
  clearInterval(poll)
  // What waits, looked at again every 10 seconds while the page is open (Web Push for a closed tab follows later).
  poll = setInterval(() => {
    if (document.visibilityState === "visible" || (canNotify() && Notification.permission === "granted")) void refresh(true)
  }, 10_000)
  show()
}

/** Reads the board, updates the Needs you count, and tells you about anything newly waiting. */
async function refresh(tell) {
  const r = await call("GET", "/api/board")
  if (!r.ok) return
  board = r.json
  const n = board.inbox.length
  needs.textContent = n ? `${n} ${n === 1 ? "needs" : "need"} you` : "Nothing waits"
  needs.classList.toggle("on", n > 0)
  inboxCount.hidden = !n
  inboxCount.textContent = String(n)
  const ids = new Set(board.inbox.map((w) => `${w.computer}/${w.requestId}`))
  const fresh = seen ? board.inbox.filter((w) => !seen.has(`${w.computer}/${w.requestId}`)) : []
  seen = ids
  if (tell && fresh.length) {
    const w = fresh[0]
    const text = fresh.length === 1 ? `${w.computerLabel}: ${w.tool} in ${w.project} waits for you.` : `${fresh.length} new requests wait for you.`
    toast(text)
    if (canNotify() && Notification.permission === "granted" && document.visibilityState !== "visible")
      new Notification("Neighbourhood Watch", { body: text, tag: "cnw-waiting" })
  }
  // The board and the inbox follow; the Server and You pages are left alone while you type in them.
  const tab = current()
  if (tell && (tab === "board" || tab === "inbox")) show()
}

const current = () => (location.hash || "#board").slice(1)

function show() {
  const tab = current()
  for (const a of tabs.querySelectorAll("a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page")
    else a.removeAttribute("aria-current")
  }
  main.replaceChildren()
  if (tab === "inbox") return inboxView()
  if (tab === "server") return void serverView()
  if (tab === "you") return void youView()
  return boardView()
}
addEventListener("hashchange", () => (tabs.hidden ? undefined : show()))

const band = (risk) => (risk >= 85 ? "Severe" : risk >= 70 ? "High" : risk >= 40 ? "Moderate" : "Low")
const riskBadge = (risk) => el("span", { class: `risk ${band(risk).toLowerCase()}`, text: `${band(risk)} ${risk}` })
const waited = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}
const ago = (ms) => (ms ? `last seen ${waited(new Date(ms).toISOString())} ago` : "never connected")

function boardView() {
  main.append(el("h1", { text: "Board" }))
  const list = el("div", { class: "list", role: "list" })
  if (!board.board.length) list.append(el("p", { class: "item muted", text: "No computer is paired yet. Pair one below, then enter the code in that computer's Codehouse, Settings, Neighbourhood Watch." }))
  for (const c of board.board) {
    const lit = c.waiting.length > 0
    const oldest = lit ? c.waiting.reduce((a, b) => (Date.parse(a.since) < Date.parse(b.since) ? a : b)) : undefined
    const parts = [
      c.online ? (c.sessions ? `${c.sessions.working} working, ${c.sessions.waiting} waiting` : (c.note ?? "")) : ago(c.lastSeen),
      c.version ? `Codehouse ${c.version}` : "",
      c.kill ? "kill switch on" : "",
      c.safeMode ? "safe mode" : "",
    ].filter(Boolean)
    list.append(
      el(
        "div",
        { role: "listitem" },
        el(
        "a",
        {
          class: `item${lit ? " lit" : ""}`,
          href: `/app/?computer=${encodeURIComponent(c.id)}`,
          "aria-label": `${c.label}: ${c.online ? "online" : "offline"}${lit ? `, ${c.waiting.length} waiting on you` : ""}. Open it.`,
        },
        el("span", { class: "time", text: lit ? waited(oldest.since) : "-" }),
        el(
          "span",
          {},
          el("span", { class: "name", text: c.label }),
          el("br"),
          el("span", { class: `state${c.online ? " on" : ""}`, text: c.online ? "Online" : "Offline" }),
          el("span", { class: "meta", text: parts.length ? `, ${parts.join(", ")}` : "" }),
          c.needsUpdate ? el("span", { class: "warn", text: ` ${c.needsUpdate === "cnw" ? "CNW needs updating" : "Codehouse needs updating"}` }) : null,
        ),
        el("span", { class: "meta", text: lit ? `${c.waiting.length} waiting` : "Open" }),
        ),
      ),
    )
  }
  main.append(list, pairPanel())
}

function pairPanel() {
  const pairing = el("section", { class: "panel" }, el("h2", { text: "Pair a computer" }))
  const out = el("p", { class: "code", "aria-live": "polite" })
  pairing.append(
    el("p", { class: "muted", text: `In that computer's Codehouse, Settings, Neighbourhood Watch, enter ${location.origin} and the code. A code works once, for ten minutes.` }),
    el("button", {
      class: "btn primary",
      text: "Make a pairing code",
      onclick: async () => {
        const c = await call("POST", "/api/computers/code", { label: "" })
        out.textContent = c.ok ? c.json.code : (c.json.error ?? "No code was made.")
      },
    }),
    out,
  )
  return pairing
}

function inboxView() {
  main.append(el("h1", { text: "Inbox" }))
  if (!board.inbox.length) return main.append(el("p", { class: "panel muted", text: "Nothing waits on you on any computer." }))
  const list = el("div", { class: "list", role: "list" })
  for (const w of board.inbox) list.append(inboxRow(w))
  main.append(list)
}

function inboxRow(w) {
  const wrap = el("div", { role: "listitem" })
  const pass = el("div", { class: "pass", hidden: true })
  const head = el(
    "button",
    { class: "item lit", style: "width:100%;text-align:left;border:0;font:inherit;color:inherit;cursor:pointer", "aria-expanded": "false" },
    el("span", { class: "time", text: waited(w.since) }),
    el("span", {}, el("span", { class: "name", text: `${w.computerLabel}: ${w.tool}` }), el("br"), el("span", { class: "meta", text: w.project })),
    riskBadge(w.risk),
  )
  head.addEventListener("click", () => {
    pass.hidden = !pass.hidden
    head.setAttribute("aria-expanded", String(!pass.hidden))
  })
  const say = el("p", { role: "status", class: "muted" })
  const answer = async (decision) => {
    say.textContent = "Sending..."
    const r = await call("POST", "/api/inbox/answer", { computer: w.computer, requestId: w.requestId, decision })
    if (r.status === 428 && r.json.reauth) return reauth(pass, say, () => answer(decision))
    say.textContent = r.ok ? r.json.sent : (r.json.error ?? "Not sent.")
    if (r.ok) setTimeout(() => refresh(false).then(show), 1500)
  }
  // Deny is one step and comes first; Allow once is never the default at risk 70 and over.
  const deny = el("button", { class: "btn", text: "Deny", onclick: () => answer("deny") })
  const allow = el("button", { class: `btn ${w.risk >= 70 ? "strong" : "primary"}`, text: w.risk >= 85 ? "Allow once (sign in again)" : "Allow once", onclick: () => answer("allow") })
  pass.append(
    el(
      "dl",
      {},
      el("dt", { text: "Computer" }),
      el("dd", { text: w.computerLabel }),
      el("dt", { text: "Would run" }),
      el("dd", { class: "mono", text: w.what || w.tool }),
      el("dt", { text: "Why it waits" }),
      el("dd", { text: w.reason || "Its rules ask you." }),
      el("dt", { text: "Rule" }),
      el("dd", { class: "mono", text: w.ruleId || "none" }),
      el("dt", { text: "Risk" }),
      el("dd", {}, riskBadge(w.risk)),
    ),
    el("p", { class: "muted", text: `Your answer goes to ${w.computerLabel}, whose own rules still decide.` }),
    el("div", { class: "row-actions" }, deny, allow),
    say,
  )
  wrap.append(head, pass)
  return wrap
}

/** A Severe allow wants a recent sign-in: the password again, then the answer is sent. */
function reauth(pass, say, then) {
  say.textContent = "This is Severe: enter your password to allow it."
  const pw = el("input", { type: "password", autocomplete: "current-password", "aria-label": "Your password" })
  const otp = me.totp ? el("input", { inputmode: "numeric", autocomplete: "one-time-code", "aria-label": "A code from your app", placeholder: "123456" }) : null
  const box = el("div", { class: "row-actions" }, pw, otp)
  box.append(
    el("button", {
      class: "btn strong",
      text: "Confirm and allow",
      onclick: async () => {
        const r = await call("POST", "/api/reauth", { password: pw.value, ...(otp ? { code: otp.value } : {}) })
        if (!r.ok) return void (say.textContent = r.json.error ?? "That did not work.")
        box.remove()
        then()
      },
    }),
  )
  pass.append(box)
  pw.focus()
}

async function serverView() {
  main.append(el("h1", { text: "Server" }))
  if (me.access !== "user") return main.append(el("p", { class: "panel muted", text: "Sign in to see and change the server's settings, even on an allowed network." }))
  if (me.role !== "owner" && me.role !== "admin") return main.append(el("p", { class: "panel muted", text: "Your role looks and answers; an owner or an admin runs the server." }))
  main.append(await healthPanel(), await serverPanel(), await peoplePanel(), await allowPanel(), await updatesPanel(), backupPanel(), await auditPanel())
}

async function allowPanel() {
  const allow = el("section", { class: "panel" }, el("h2", { text: "Allowed networks" }))
  const a = await call("GET", "/api/allowlist")
  const box = el("input", { value: (a.json.ranges ?? []).join(", "), "aria-label": "Allowed address ranges", placeholder: "192.168.1.0/24" })
  const msg = el("p", { class: "muted", "aria-live": "polite" })
  allow.append(
    el("p", { class: "muted", text: "Addresses here need no sign-in to look and answer. They still need it to change this list or the server's settings, remove a computer or allow a Severe request. Leave it empty to always sign in." }),
    box,
    el("button", {
      class: "btn",
      text: "Save",
      onclick: async () => {
        const ranges = box.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        const r2 = await call("PUT", "/api/allowlist", { ranges })
        msg.textContent = r2.ok ? "Saved." : (r2.json.error ?? "Not saved.")
      },
    }),
    msg,
  )
  return allow
}

/** Server: Health. Free space, memory, how long CNW has run, the updater and caddy, and each computer's connections. */
async function healthPanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "Health" }))
  const r = await call("GET", "/api/health")
  if (!r.ok) return panel.append(el("p", { class: "muted", text: r.json.error ?? "Not available." })), panel
  const h = r.json
  const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`
  const up = (s) => (s < 3600 ? `${Math.round(s / 60)} minutes` : s < 86400 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`)
  const line = (label, value, bad) => el("p", {}, el("span", { class: "muted", text: `${label}: ` }), el("span", { class: bad ? "err" : "", text: value }))
  if (h.disk) panel.append(line("Free space for CNW's data", `${gb(h.disk.free)} of ${gb(h.disk.total)}`, h.disk.free < 1024 ** 3))
  panel.append(line("Memory free", `${gb(h.memory.free)} of ${gb(h.memory.total)}`), line("Running for", up(h.uptimeSeconds)))
  if (h.updater !== undefined) panel.append(line("Updater", h.updater ? "answering" : "not answering", !h.updater))
  if (h.caddy !== undefined) panel.append(line("caddy (the certificate)", h.caddy ? "answering" : "not answering", !h.caddy))
  for (const c of h.computers) {
    const last = c.history.slice(-5).reverse()
    panel.append(
      el(
        "p",
        {},
        el("strong", { text: `${c.label}: ` }),
        el("span", { text: c.online ? "connected" : "not connected" }),
        el("span", { class: "muted", text: last.length ? `. Last: ${last.map((e) => `${e.event} ${when(e.at)}`).join("; ")}` : "" }),
      ),
    )
  }
  return panel
}

/** Server: Updates. This version, the newest signed one and what it changes, going back, and updating by itself. */
async function updatesPanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "Updates" }))
  const r = await call("GET", "/api/updates")
  const u = r.json
  const say = el("p", { class: "muted", role: "status" })
  panel.append(el("p", { text: `This is Neighbourhood Watch ${u.current ?? "?"}.${u.latest ? (u.newer ? ` ${u.latest} is out.` : " It is the newest.") : ""}` }))
  if (u.notes) panel.append(el("p", { class: "muted", text: u.notes }))
  if (u.note) panel.append(el("p", { class: "warn", text: u.note }))
  panel.append(
    el("button", {
      class: "btn primary",
      text: "Update to the latest signed release",
      onclick: async () => {
        say.textContent = "Updating: this can take a few minutes, and the page reloads when it is done."
        const x = await call("POST", "/api/update")
        say.textContent = x.ok ? x.json.message : (x.json.error ?? "It did not update.")
        if (x.ok && /Updated/.test(x.json.message ?? "")) setTimeout(() => location.reload(), 20000)
      },
    }),
  )
  if (u.previous)
    panel.append(
      el("p", { class: "muted", text: `Version ${u.previous.version}, from before the last update, is kept to go back to.` }),
      el("button", {
        class: "btn",
        text: `Go back to ${u.previous.version}`,
        onclick: async () => {
          if (!(await ask(`Go back to ${u.previous.version}?`, "CNW starts again with that version, which takes a minute.", "Go back"))) return
          const x = await call("POST", "/api/update/rollback")
          if (x.status === 428) return void (say.textContent = "Sign in again first (sign out and in), then go back.")
          say.textContent = x.ok ? x.json.message : (x.json.error ?? "It did not go back.")
        },
      }),
    )
  const auto = el("input", { type: "checkbox" })
  auto.checked = Boolean(u.auto?.auto)
  const hour = el("input", { type: "number", min: "0", max: "23", value: String(u.auto?.hour ?? 3), style: "width:6em" })
  panel.append(
    el("label", { style: "display:flex;gap:8px;align-items:center" }, auto, el("span", { text: "Update by itself when a signed release is out, at this hour:" }), hour),
    el("button", {
      class: "btn",
      text: "Save",
      onclick: async () => {
        const x = await call("PUT", "/api/updates", { auto: auto.checked, hour: Number(hour.value) })
        say.textContent = x.ok ? "Saved." : (x.json.error ?? "Not saved.")
      },
    }),
    say,
  )
  return panel
}

/** Server: Backup and restore, for an owner. The passphrase is the only way to open the file: keep it. */
function backupPanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "Backup and restore" }))
  if (me.role !== "owner") return panel.append(el("p", { class: "muted", text: "An owner makes and restores backups." })), panel
  const say = el("p", { class: "muted", role: "status" })
  const pass = el("input", { type: "password", autocomplete: "new-password", minlength: "12", "aria-label": "A passphrase for the backup" })
  const file = el("input", { type: "file", accept: ".cnwbackup", "aria-label": "A backup file" })
  const pass2 = el("input", { type: "password", autocomplete: "off", "aria-label": "Its passphrase" })
  const fresh = (x) => (x.status === 428 ? "Sign in again first (sign out and in): a backup holds everything." : (x.json.error ?? "That did not work."))
  panel.append(
    el("p", { class: "muted", text: "A backup holds the people, settings, paired computers and the audit, encrypted with a passphrase you choose. Without the passphrase nobody can open it, you included. caddy's certificate is not in it: restored onto a new server, each computer pairs again." }),
    el("label", {}, el("span", { text: "A passphrase of 12 characters or more" }), pass),
    el("button", {
      class: "btn",
      text: "Make a backup",
      onclick: async () => {
        const r = await fetch("/api/backup", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ passphrase: pass.value }) })
        if (!r.ok) return void (say.textContent = fresh({ status: r.status, json: await r.json().catch(() => ({})) }))
        const blob = await r.blob()
        const a = el("a", { href: URL.createObjectURL(blob), download: `neighbourhood-watch-${new Date().toISOString().slice(0, 10)}.cnwbackup` })
        document.body.append(a)
        a.click()
        a.remove()
        say.textContent = "The backup is in your downloads. Keep the passphrase with it, apart from it."
      },
    }),
    el("h2", { text: "Restore" }),
    el("label", {}, el("span", { text: "A backup file" }), file),
    el("label", {}, el("span", { text: "Its passphrase" }), pass2),
    el("button", {
      class: "btn danger",
      text: "Restore it",
      onclick: async () => {
        const f = file.files?.[0]
        if (!f) return void (say.textContent = "Choose a backup file first.")
        if (!(await ask("Restore this backup?", "Everything here now (people, settings, paired computers, the audit) is replaced by the backup, and CNW starts again.", "Restore it"))) return
        const x = await call("POST", "/api/restore", { backup: await f.text(), passphrase: pass2.value })
        say.textContent = x.ok ? x.json.message : fresh(x)
        if (x.ok) setTimeout(() => location.reload(), 8000)
      },
    }),
    say,
  )
  return panel
}

/** Server: the audit log of what was changed and answered in CNW, newest first. */
async function auditPanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "Audit log" }))
  const list = el("div", { class: "list", role: "list" })
  let before
  const more = el("button", { class: "btn", text: "Older" })
  const load = async () => {
    const r = await call("GET", `/api/audit?limit=30${before ? `&before=${encodeURIComponent(before)}` : ""}`)
    for (const e of r.json.entries ?? [])
      list.append(
        el(
          "div",
          { class: "item", role: "listitem", style: "grid-template-columns:auto 1fr" },
          el("span", { class: "meta", text: when(e.at) }),
          el("span", {}, el("strong", { text: `${e.user}: ` }), el("span", { text: `${e.action.replace(/-/g, " ")}, ${e.detail}` })),
        ),
      )
    before = r.json.more
    more.hidden = !before
  }
  more.addEventListener("click", load)
  await load()
  if (!list.children.length) list.append(el("p", { class: "item muted", text: "Nothing yet." }))
  panel.append(list, more)
  return panel
}

// Uplift phase 2: the Server panel. CNW's address, its kind of certificate and its port, set here instead of .env; the
// certificate's fingerprint to compare with Codehouse's pin; and caddy's root certificate to trust.
async function serverPanel() {
  const panel = el("section", { class: "panel", "aria-labelledby": "server-h" }, el("h2", { id: "server-h", text: "Address and certificate" }))
  const r = await call("GET", "/api/server")
  if (!r.ok) {
    panel.append(el("p", { class: "muted", text: r.json.error ?? "Sign in to see the server's settings." }))
    return panel
  }
  const v = r.json
  const field = (label, input, help) => el("label", {}, el("span", { text: label }), input, help ? el("span", { class: "muted", text: help }) : null)
  const host = el("input", { value: v.effective.host, autocomplete: "off", autocapitalize: "none", spellcheck: "false" })
  const tlsSel = el("select", {})
  for (const [val, text] of [
    ["", "Chosen from the address"],
    ["internal", "caddy's own (home network, IP address)"],
    ["public", "Let's Encrypt (a public name)"],
  ]) {
    const opt = el("option", { value: val, text })
    if (val === (v.effective.tls ?? "")) opt.selected = true
    tlsSel.append(opt)
  }
  const port = el("input", { value: v.effective.port ?? "", inputmode: "numeric", placeholder: "443" })
  const proxy = el("input", { value: v.effective.trustedProxy ?? "", placeholder: "192.168.1.10" })
  const say = el("p", { class: "muted", role: "status" })
  panel.append(
    el("p", { class: "muted", text: "Saved here, these win over .env. A change to the address or the kind of certificate gives CNW a new certificate, and every paired computer must be paired again." }),
    field("Address people browse to", host),
  )
  if (!v.ownProxy) panel.append(field("Certificate", tlsSel), field("Port", port, "Leave empty for 443."))
  else panel.append(field("Your proxy's address (trusted proxy)", proxy, "Only its X-Forwarded-For is believed."))
  if (v.portInEnv !== undefined)
    panel.append(el("p", { class: "err", text: `.env sets the port to ${v.portInEnv || "443"}, which Docker uses when the stack is started by hand. Set CNW_PORT in .env to the same, or remove it.` }))
  if (v.certificate) panel.append(el("p", {}, el("span", { class: "muted", text: "Certificate fingerprint (SHA-256), the one Codehouse pins: " }), el("span", { class: "code fp", text: v.certificate })))
  if (v.rootCertificate)
    panel.append(
      el(
        "p",
        {},
        el("a", { class: "btn", href: "/api/server/root.crt", download: true, text: "Download the root certificate" }),
        el("span", { class: "muted", text: " Trust it on your phone and computers: no warnings, and notifications can reach a closed tab." }),
      ),
    )
  const save = async (confirm) => {
    say.textContent = "Saving..."
    const body = { host: host.value, tls: tlsSel.value, port: port.value, trustedProxy: proxy.value, ...(confirm ? { confirm: true } : {}) }
    const s = await call("PUT", "/api/server", body)
    if (s.status === 409 && s.json.breaks) {
      const names = s.json.breaks.length ? `: ${s.json.breaks.join(", ")}` : ""
      say.textContent = ""
      if (await ask("A new certificate", `${s.json.error} That is every paired computer${names}.`, "Change it")) return save(true)
      return
    }
    say.textContent = s.ok ? s.json.message : (s.json.error ?? s.json.message ?? "Not saved.")
  }
  panel.append(el("button", { class: "btn primary", text: "Save", onclick: () => save(false) }), say)
  return panel
}

async function youView() {
  main.append(el("h1", { text: "You" }))
  if (me.access !== "user") return main.append(el("p", { class: "panel muted", text: "This page is open from an allowed network, without signing in. Sign in to see your account." }))
  // Notifications while this page is open; asked for only when you choose, never on opening the page.
  const note = el("section", { class: "panel" }, el("h2", { text: "Notifications" }))
  const nsay = el("p", { class: "muted", role: "status" })
  const state = () =>
    !canNotify()
      ? "This browser cannot show notifications."
      : Notification.permission === "granted"
        ? "On: while a Neighbourhood Watch tab is open, a new request shows as a notification even when you are in another app."
        : Notification.permission === "denied"
          ? "Blocked in this browser's settings for this site. Allow notifications there to use them."
          : "Off. A new request still shows on this page."
  nsay.textContent = state()
  note.append(
    nsay,
    canNotify() && Notification.permission === "default"
      ? el("button", {
          class: "btn",
          text: "Turn on notifications",
          onclick: async () => {
            await Notification.requestPermission()
            nsay.textContent = state()
          },
        })
      : null,
    el("p", { class: "muted", text: "Notifications for a closed tab or a locked phone (Web Push) come in a later update, and need this server's root certificate trusted on the device." }),
  )
  const acct = el("section", { class: "panel" }, el("h2", { text: "Your email" }), el("p", { text: me.email ?? me.user }))
  const keys = el("section", { class: "panel" }, el("h2", { text: "Passkeys" }))
  const said = el("p", { class: "muted", "aria-live": "polite", text: "A passkey signs you in with your face, fingerprint or device PIN, and cannot be phished." })
  keys.append(
    said,
    passkeysOff
      ? el("p", { class: "muted", text: passkeysOff })
      : canPasskey()
        ? el("button", { class: "btn", text: "Add a passkey", onclick: () => passkeyAdd(said) })
        : el("p", { class: "muted", text: "This browser cannot make passkeys." }),
  )
  main.append(acct, note, keys, totpPanel(), await devicesPanel(), computersPanel())
}

/** Removing a computer: on You, away from the board, with what it means said first. */
function computersPanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "Paired computers" }))
  for (const c of board.board)
    panel.append(
      el(
        "div",
        { class: "row-actions", style: "align-items:center" },
        el("span", { style: "flex:1", text: `${c.label}${c.tags?.length ? ` (${c.tags.join(", ")})` : ""}` }),
        me.role === "owner" || me.role === "admin"
          ? el("button", {
              class: "btn",
              text: "Rename",
              "aria-label": `Rename ${c.label}`,
              onclick: async () => {
                const v = await ask(`Rename ${c.label}`, "", "Save", [
                  ["label", "Its name", c.label],
                  ["tags", "Tags to group it by, separated by commas", (c.tags ?? []).join(", ")],
                ])
                if (!v) return
                const r = await call("PATCH", `/api/computers/${encodeURIComponent(c.id)}`, { label: v.label, tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean) })
                if (!r.ok) return toast(r.json.error ?? "Not renamed.")
                await refresh(false)
                show()
              },
            })
          : null,
        el("button", {
          class: "btn danger",
          text: "Remove",
          "aria-label": `Remove ${c.label}`,
          onclick: async () => {
            if (!(await ask(`Remove ${c.label}?`, "It is disconnected at once, and must be paired again to come back.", "Remove it"))) return
            const d = await call("DELETE", `/api/computers/${encodeURIComponent(c.id)}`)
            if (!d.ok) return toast(d.json.error ?? "Not removed.")
            await refresh(false)
            show()
          },
        }),
      ),
    )
  if (!board.board.length) panel.append(el("p", { class: "muted", text: "None yet." }))
  return panel
}

/** After the password, with a second factor: a code from the app, or a recovery code. */
function codeStep(ticket) {
  main.replaceChildren(
    form(
      "A code from your app",
      [["code", "The six-digit code, or a recovery code", "text", { inputmode: "numeric", autocomplete: "one-time-code", autocapitalize: "none", spellcheck: "false" }]],
      "Sign in",
      async (v) => {
        const r = await call("POST", "/api/login/totp", { ticket, code: v.code })
        if (!r.ok) return r.json.error ?? "That did not work."
        render()
      },
      "Open your authenticator app and type the code shown for Neighbourhood Watch. Lost your phone? A recovery code works once.",
    ),
  )
}

/** You: a second factor, set up from your authenticator app; on, it can be turned off with your password and a code. */
function totpPanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "Second factor" }))
  const say = el("p", { class: "muted", role: "status" })
  if (me.totp) {
    const pw = el("input", { type: "password", autocomplete: "current-password", "aria-label": "Your password" })
    const code = el("input", { inputmode: "numeric", autocomplete: "one-time-code", "aria-label": "A code from your app" })
    panel.append(
      el("p", { text: "On: signing in wants a code from your app after your password." }),
      el("label", {}, el("span", { text: "To turn it off: your password" }), pw),
      el("label", {}, el("span", { text: "and a code from your app" }), code),
      el("button", {
        class: "btn danger",
        text: "Turn it off",
        onclick: async () => {
          const r = await call("DELETE", "/api/totp", { password: pw.value, code: code.value })
          if (!r.ok) return void (say.textContent = r.json.error ?? "Not turned off.")
          await render()
          location.hash = "#you"
        },
      }),
      say,
    )
    return panel
  }
  panel.append(el("p", { class: "muted", text: "A six-digit code from an authenticator app (such as the one in your phone's passwords) after your password. It works at an IP address, where passkeys cannot." }))
  const setUp = el("button", {
    class: "btn",
    text: "Set up a second factor",
    onclick: async () => {
      const r = await call("POST", "/api/totp/start")
      if (!r.ok) return void (say.textContent = r.json.error ?? "Not available.")
      setUp.remove()
      const code = el("input", { inputmode: "numeric", autocomplete: "one-time-code", "aria-label": "The code your app shows" })
      panel.append(
        el("p", { text: "In your authenticator app, add an account with this key (or open the link on this phone):" }),
        el("p", { class: "code fp", text: r.json.key }),
        el("p", {}, el("a", { href: r.json.uri, text: "Add to an authenticator app on this device" })),
        el("label", {}, el("span", { text: "Then type the code it shows" }), code),
        el("button", {
          class: "btn primary",
          text: "Turn it on",
          onclick: async () => {
            const c = await call("POST", "/api/totp/confirm", { code: code.value })
            if (!c.ok) return void (say.textContent = c.json.error ?? "Not turned on.")
            me.totp = true
            panel.replaceChildren(
              el("h2", { text: "Second factor" }),
              el("p", { text: "On. Keep these recovery codes somewhere safe: each signs you in once if you lose your phone, and they are not shown again." }),
              el("p", { class: "code fp", text: c.json.recovery.join("  ") }),
            )
          },
        }),
      )
    },
  })
  panel.append(setUp, say)
  return panel
}

/** You: where you are signed in, each with Sign out. */
async function devicesPanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "Signed-in devices" }))
  const r = await call("GET", "/api/devices")
  for (const d of r.json.devices ?? [])
    panel.append(
      el(
        "div",
        { class: "row-actions", style: "align-items:center" },
        el("span", { style: "flex:1", text: `${deviceName(d.ua)}${d.ip ? ` from ${d.ip}` : ""}, since ${when(d.created)}${d.current ? " (this one)" : ""}` }),
        d.current
          ? null
          : el("button", {
              class: "btn",
              text: "Sign out",
              onclick: async () => {
                await call("DELETE", `/api/devices/${encodeURIComponent(d.id)}`)
                show()
              },
            }),
      ),
    )
  return panel
}

/** Server: people, for an owner or an admin. An invite is a link to copy and send; it works once, for seven days. */
async function peoplePanel() {
  const panel = el("section", { class: "panel" }, el("h2", { text: "People" }))
  const r = await call("GET", "/api/people")
  if (!r.ok) return panel.append(el("p", { class: "muted", text: r.json.error ?? "Not available." })), panel
  const roles = [
    ["owner", "Owner: everything"],
    ["admin", "Admin: the server and people, not owners"],
    ["approver", "Approver: answers what waits"],
    ["viewer", "Viewer: looks only"],
  ]
  const say = el("p", { class: "muted", role: "status" })
  for (const p of r.json.people) {
    const sel = el("select", { "aria-label": `Role for ${p.email ?? p.name}` })
    for (const [v, t] of roles) {
      const o = el("option", { value: v, text: t })
      if (v === p.role) o.selected = true
      sel.append(o)
    }
    sel.addEventListener("change", async () => {
      const c = await call("PATCH", `/api/people/${encodeURIComponent(p.name)}`, { role: sel.value })
      say.textContent = c.ok ? `${p.email ?? p.name} is now ${sel.value}.` : (c.json.error ?? "Not changed.")
      if (!c.ok) sel.value = p.role
    })
    panel.append(
      el(
        "div",
        { class: "row-actions", style: "align-items:center" },
        el("span", { style: "flex:1", text: `${p.email ?? p.name}${p.computers ? `, ${p.computers.length} computer(s)` : ""}${p.totp ? ", second factor on" : ""}` }),
        sel,
        p.name === me.user
          ? null
          : el("button", {
              class: "btn danger",
              text: "Remove",
              onclick: async () => {
                if (!(await ask(`Remove ${p.email ?? p.name}?`, "They are signed out everywhere at once, and need a new invite to come back.", "Remove them"))) return
                const d = await call("DELETE", `/api/people/${encodeURIComponent(p.name)}`)
                if (!d.ok) return void (say.textContent = d.json.error ?? "Not removed.")
                show()
              },
            }),
      ),
    )
  }
  const email = el("input", { type: "email", inputmode: "email", autocomplete: "off", "aria-label": "Their email" })
  const role = el("select", { "aria-label": "Their role" })
  for (const [v, t] of roles.slice(1)) role.append(el("option", { value: v, text: t }))
  if (me.role === "owner") role.prepend(el("option", { value: "owner", text: roles[0][1] }))
  role.value = "approver"
  const link = el("p", { class: "mono" })
  panel.append(
    el("h2", { text: "Invite someone" }),
    el("label", {}, el("span", { text: "Their email" }), email),
    el("label", {}, el("span", { text: "Their role" }), role),
    el("button", {
      class: "btn primary",
      text: "Make an invite link",
      onclick: async () => {
        const c = await call("POST", "/api/people/invite", { email: email.value, role: role.value })
        if (!c.ok) return void (say.textContent = c.json.error ?? "No invite was made.")
        link.textContent = c.json.link
        say.textContent = "Send them this link. It works once, until " + day(c.json.expires) + "."
      },
    }),
    link,
    say,
  )
  return panel
}

signout.addEventListener("click", async () => {
  await call("POST", "/api/logout")
  csrf = ""
  sessionStorage.removeItem("cnw.csrf")
  seen = undefined
  render()
})

render()
