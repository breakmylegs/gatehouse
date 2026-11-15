// Codehouse Neighbourhood Watch's own pages (O41): first-time setup, sign-in (password, with passkeys offered),
// the computers with Open, a pairing code for a new computer, and the IP allow list. Everything else is the full
// Codehouse interface at /app/?computer=<id>. All text is set with textContent, never as HTML.
const main = document.getElementById("main")
const signout = document.getElementById("signout")
let csrf = ""

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") e.textContent = v
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v)
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
  const f = el("form", { class: "panel" }, el("h2", { text: title }), note ? el("p", { class: "muted", text: note }) : null)
  const inputs = {}
  for (const [name, label, type, extra] of fields) {
    const i = el("input", { name, type, required: "", ...(extra ?? {}) })
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

async function render() {
  const me = (await call("GET", "/api/me")).json
  main.replaceChildren()
  main.className = ""
  signout.hidden = me.access !== "user"
  if (me.access === "user") {
    csrf = me.csrf
    sessionStorage.setItem("cnw.csrf", me.csrf)
  }
  if (me.setup)
    return main.append(
      form(
        "Set up Neighbourhood Watch",
        [
          ["code", "Setup code (printed once in the server's log)", "text", { autocomplete: "off" }],
          ["name", "Your name", "text", { autocomplete: "username" }],
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
  if (me.access === "none")
    return main.append(
      form(
        "Sign in",
        [
          ["name", "Name", "text", { autocomplete: "username webauthn" }],
          ["password", "Password", "password", { autocomplete: "current-password" }],
        ],
        "Sign in",
        async (v) => {
          const r = await call("POST", "/api/login", v)
          if (!r.ok) return r.json.error ?? "That did not work."
          render()
        },
      ),
    )
  await computers()
}

async function computers() {
  main.className = "two"
  const list = el("section", { class: "panel" }, el("h2", { text: "Computers" }))
  const r = await call("GET", "/api/computers")
  const items = r.json.computers ?? []
  if (!items.length) list.append(el("p", { class: "muted", text: "No computer is paired yet. Make a code on the right and enter it in Codehouse, Settings, Neighbourhood Watch." }))
  for (const c of items) {
    const row = el(
      "div",
      { class: "computer" },
      el("span", { class: `dot${c.online ? " on" : ""}`, "aria-hidden": "true" }),
      el("span", { text: `${c.label}${c.online ? "" : " (not connected)"}${c.version ? `, Codehouse ${c.version}` : ""}`, style: "flex:1" }),
      el("a", { class: "btn primary", href: `/app/?computer=${encodeURIComponent(c.id)}`, text: "Open" }),
      el("button", {
        class: "btn",
        text: "Remove",
        "aria-label": `Remove ${c.label}`,
        onclick: async () => {
          if (!confirm(`Remove ${c.label}? It is disconnected at once and must be paired again.`)) return
          const d = await call("DELETE", `/api/computers/${encodeURIComponent(c.id)}`)
          if (!d.ok) alert(d.json.error ?? "Not removed.")
          render()
        },
      }),
    )
    list.append(row)
  }
  const pairing = el("section", { class: "panel" }, el("h2", { text: "Pair a computer" }))
  const out = el("p", { class: "code", "aria-live": "polite" })
  pairing.append(
    el("p", { class: "muted", text: "Make a code, then enter this page's address and the code in that computer's Codehouse, Settings, Neighbourhood Watch. A code works once, for ten minutes." }),
    el("button", {
      class: "btn primary",
      text: "Make a pairing code",
      onclick: async () => {
        const c = await call("POST", "/api/computers/code", { label: "" })
        out.textContent = c.ok ? c.json.code : c.json.error ?? "No code was made."
      },
    }),
    out,
  )
  const allow = el("section", { class: "panel" }, el("h2", { text: "Allowed networks" }))
  const a = await call("GET", "/api/allowlist")
  const box = el("input", { value: (a.json.ranges ?? []).join(", "), "aria-label": "Allowed address ranges", placeholder: "192.168.1.0/24" })
  const msg = el("p", { class: "muted", "aria-live": "polite" })
  allow.append(
    el("p", { class: "muted", text: "Addresses here need no sign-in. They still need it to change this list, remove a computer or approve a Severe request. Leave it empty to always sign in." }),
    box,
    el("button", {
      class: "btn",
      text: "Save",
      onclick: async () => {
        const ranges = box.value.split(",").map((s) => s.trim()).filter(Boolean)
        const r2 = await call("PUT", "/api/allowlist", { ranges })
        msg.textContent = r2.ok ? "Saved." : r2.json.error ?? "Not saved."
      },
    }),
    msg,
  )
  main.append(list, pairing, allow)
}

signout.addEventListener("click", async () => {
  await call("POST", "/api/logout")
  csrf = ""
  sessionStorage.removeItem("cnw.csrf")
  render()
})

render()
