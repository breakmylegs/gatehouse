// The pictures in the README: the real interface with realistic sample data and a stand-in for the Host, so nothing
// personal or from a real project appears. Served by the dev server only (screens.html), never packaged.
//   screens.html?view=approvals|workspace|update|settings|policy|sessions&theme=light|dark
// scripts/screenshots.ts opens each view in Edge and saves the picture into docs/images.
import type { PendingView, SessionInfo } from "@gatehouse/shared"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../App"
import "../styles.css"
import type { UpdateStatus } from "../lib/update"
import { startConnection, useStore } from "../store"

const params = new URLSearchParams(location.search)
const view = params.get("view") ?? "approvals"
const theme = params.get("theme") === "dark" ? "dark" : "light"
const now = Date.now()
const iso = (ms: number) => new Date(now + ms).toISOString()

const UPDATE: UpdateStatus = {
  current: "1.0.74",
  kind: "release",
  canInstall: true,
  previous: "1.0.71",
  settings: { checkEveryMinutes: 30, downloadInBackground: true, skipped: [] },
  where: "https://github.com/breakmylegs/gatehouse/releases",
  tokenSet: false,
  checking: false,
  lastCheck: iso(-4 * 60_000),
  nextCheck: iso(26 * 60_000),
  available: true,
  latest: {
    version: "1.0.75",
    notes: [
      "- Allow or deny a request inside the session that asked",
      "- What Claude may do, in plain words, with three levels",
      "- Start a new project from what you want to build",
    ].join("\n"),
  },
  phase: "ready",
  ready: "1.0.75",
}

const SETTINGS = {
  path: "%LOCALAPPDATA%\\Gatehouse\\config.json",
  saved: {
    expectedOrg: "Example Ltd",
    redactTerms: ["Northwind"],
    workspaceRoots: ["C:/dev"],
    projectsFolder: "C:\\dev",
  },
  running: {
    expectedOrg: "Example Ltd",
    redactTerms: ["Northwind"],
    workspaceRoots: ["C:/dev"],
    phoneExpiryMs: 600_000,
    hardTimeoutMs: 1_800_000,
    checkpoints: { beforeEscalation: true, editBursts: true, burstWindowMs: 60_000 },
    updates: UPDATE.settings,
  },
  workspaceRootsInEffect: ["C:/dev"],
  quietHoursInPolicy: null,
}

const FILES = [
  { name: "src", rel: "src", kind: "dir", size: 0, mtime: iso(-60_000) },
  { name: "tests", rel: "tests", kind: "dir", size: 0, mtime: iso(-60_000) },
  { name: "package.json", rel: "package.json", kind: "file", size: 1240, mtime: iso(-86_400_000) },
  { name: "README.md", rel: "README.md", kind: "file", size: 3100, mtime: iso(-86_400_000) },
]

// The Policy page: the packs behind its choices, your rules (kept as you change them), suggestions and Try it.
const PACKS = [
  "build-tools",
  "cloud-read",
  "containers",
  "dotnet-dev",
  "edit-workspace",
  "git-local",
  "git-read",
  "node-dev",
  "packages",
  "python-dev",
  "run-app",
  "web-read",
  "windows-safety",
].map((id) => ({
  id,
  title: id,
  description: "",
  on: false,
  rules: [{ id: `${id}-rule` }],
  cases: [],
}))
let userRules: Record<string, unknown> = {
  version: 1,
  packs: [
    "build-tools",
    "dotnet-dev",
    "edit-workspace",
    "git-local",
    "git-read",
    "node-dev",
    "python-dev",
    "run-app",
    "web-read",
  ],
}
const POLICY = {
  status: { hash: "6a0baa0aea40", errors: [], overlays: [] },
  rulesPath: "C:\\Users\\you\\AppData\\Local\\Programs\\JCVC\\app\\policy\\rules.yaml",
  rulesYaml: "version: 1\n",
  rulesYamlHash: "x",
  rules: { floor: [], deny: [], escalate: [], allow: [], workspaceRoots: ["C:/dev"] },
  remember: [{ id: "remember-1", tools: ["Bash"], commands: ["npm run storybook"] }],
  localYaml: "",
}
const SUGGESTIONS = [
  {
    candidate: { tool: "Bash", command: "npx playwright test" },
    preview: "",
    approvals: 7,
    lastSeen: iso(-3_600_000),
    ruleIds: ["no-rule"],
  },
]

/** A fortnight of sample usage for the Usage page: three projects, two models. */
const USAGE_REPORT = (() => {
  const day = (back: number) => {
    const d = new Date()
    d.setDate(d.getDate() - back)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const t = (costUsd: number) => ({
    costUsd,
    inputTokens: Math.round(costUsd * 40),
    outputTokens: Math.round(costUsd * 6000),
    turns: Math.max(1, Math.round(costUsd)),
  })
  const days: Record<string, Record<string, unknown>> = {}
  const spend = [2.1, 6.4, 0, 3.2, 8.9, 12.4, 4.1, 0.6, 9.8, 15.2, 7.7, 21.3, 18.1, 45.5]
  spend.forEach((c, i) => {
    if (!c) return
    days[day(spend.length - 1 - i)] = {
      "019a3b2c-1d00-7abc-8000-000000000001": {
        project: "billing-service",
        total: t(c * 0.6),
        models: { "claude-opus-5-5": t(c * 0.55), "claude-haiku-5-5": t(c * 0.05) },
      },
      "019a3b2c-1d00-7abc-8000-000000000002": {
        project: "docs-site",
        total: t(c * 0.3),
        models: { "claude-sonnet-5-5": t(c * 0.3) },
      },
      "019a3b2c-1d00-7abc-8000-000000000003": {
        project: "atlas",
        total: t(c * 0.1),
        models: { "claude-opus-5-5": t(c * 0.1) },
      },
    }
  })
  return { from: day(29), to: day(0), splitSince: day(13), days, daysWithoutCells: {} }
})()

// The stand-in for the Host's admin API.
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const p = new URL(url, location.href).pathname
  const json = (d: unknown) =>
    new Response(JSON.stringify(d), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  if (p === "/api/update") return json(UPDATE)
  if (p === "/api/usage/report") {
    const q = new URL(url, location.href).searchParams
    return json({
      ...USAGE_REPORT,
      from: q.get("from") ?? USAGE_REPORT.from,
      to: q.get("to") ?? USAGE_REPORT.to,
    })
  }
  if (p === "/api/digest")
    return json({
      text: "In the last 24 hours: 214 calls went through automatically and 9 asked you.",
      askedYou: 9,
    })
  if (p === "/api/settings") return json(SETTINGS)
  if (p.startsWith("/api/files/list")) return json({ entries: FILES, more: 0 })
  if (p === "/api/jcvc/pictures")
    return json({ names: [], folder: "%LOCALAPPDATA%\\Gatehouse\\jcvc" })
  if (p === "/api/push") return json({ ntfy: { enabled: false, listening: false, sent: 0 } })
  if (p === "/api/files/attach-data") return json({ rel: ".jcvc/attachments/demo-shot.png" })
  if (p === "/api/library" && init?.method === "PUT") {
    userRules = JSON.parse(String(init.body)) as Record<string, unknown>
    return json({ changed: [] })
  }
  if (p === "/api/library")
    return json({ path: "rules.user.yaml", errors: [], packs: PACKS, base: [], user: userRules })
  if (p === "/api/policy") return json(POLICY)
  if (p === "/api/suggestions") return json(SUGGESTIONS)
  if (p === "/api/policy/test")
    return json({
      outcome: "escalate",
      ruleId: "package-install",
      reason: "Installs packages from the network.",
      risk: 70,
    })
  if (p.startsWith("/api/")) return json({})
  return realFetch(input, init)
}

const sessions: SessionInfo[] = [
  {
    id: "s1",
    cwd: "C:/dev/billing-service",
    project: "billing-service",
    model: "claude-opus-5-5",
    mode: "default",
    state: "running",
    pendingApprovals: 2,
    createdAt: iso(-42 * 60_000),
  },
  {
    id: "s2",
    cwd: "C:/dev/docs-site",
    project: "docs-site",
    model: "claude-sonnet-5-5",
    mode: "acceptEdits",
    state: "waiting",
    pendingApprovals: 1,
    createdAt: iso(-18 * 60_000),
  },
  {
    id: "s3",
    cwd: "C:/dev/infra-scripts",
    project: "infra-scripts",
    model: "claude-sonnet-5-5",
    mode: "plan",
    state: "idle",
    pendingApprovals: 0,
    createdAt: iso(-3 * 3_600_000),
    title: "Plan the move to the new backup host",
    pinned: true,
  },
] as SessionInfo[]

function request(
  i: number,
  o: {
    session: string
    project: string
    tool: string
    input: Record<string, unknown>
    rule: string
    reason: string
    risk: number
    ago: number
  },
): PendingView {
  return {
    request: {
      id: `r${i}`,
      nonce: "n",
      kind: "permission",
      sessionId: o.session,
      toolUseId: `tu${i}`,
      toolName: o.tool,
      input: o.input,
      cwd: `C:/dev/${o.project}`,
      project: o.project,
      verdict: {
        outcome: "escalate",
        ruleId: o.rule,
        reason: o.reason,
        risk: o.risk,
        segments: [],
        decidedBy: "rules",
        policyHash: "h",
      },
      createdAt: iso(-o.ago),
      expiresAt: iso(600_000),
      payloadHash: "p",
    },
    rawInput: o.input,
    defaultToNo: o.risk >= 70,
    phone: i === 1 ? "delivered" : "none",
    hardDeadline: iso(1_800_000),
  } as PendingView
}

const pending: PendingView[] = [
  request(1, {
    session: "s1",
    project: "billing-service",
    tool: "Bash",
    input: { command: "git push origin feature/csv-export", description: "Push the branch" },
    rule: "git-push",
    reason: "Pushing to a remote shares your work outside this computer, so it waits for you.",
    risk: 55,
    ago: 95_000,
  }),
  request(2, {
    session: "s2",
    project: "docs-site",
    tool: "Bash",
    input: {
      command: "npm install remark-gfm@4.0.1",
      description: "Add GitHub tables to the docs",
    },
    rule: "package-install",
    reason: "Installing a package runs its install scripts on this computer.",
    risk: 42,
    ago: 40_000,
  }),
  request(3, {
    session: "s1",
    project: "billing-service",
    tool: "Edit",
    input: {
      file_path: "C:/dev/billing-service/src/invoices/export.ts",
      old_string:
        "export function toRows(invoices: Invoice[]) {\n  return invoices.map((i) => [i.id, i.total])\n}",
      new_string:
        "export function toRows(invoices: Invoice[]) {\n  return invoices.map((i) => [i.id, i.customer, i.issuedAt, i.total.toFixed(2)])\n}",
    },
    rule: "edit-source",
    reason: "Edits to source files wait for you while this session is in Manual mode.",
    risk: 24,
    ago: 12_000,
  }),
]

function transcript() {
  const h = useStore.getState().handleEvent
  const say = (sessionId: string, message: unknown) =>
    h({ type: "sdk_message", sessionId, message })
  say("s1", {
    type: "system",
    subtype: "init",
    model: "claude-opus-5-5",
    slash_commands: ["compact", "review"],
    skills: [],
    mcp_servers: [{ name: "companion", status: "connected" }],
    plugins: [],
  })
  say("s1", {
    type: "user",
    message: { role: "user", content: "Add a CSV export to the invoices page, with tests." },
  })
  say("s1", {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "I'll look at how the invoices page loads its data, then add the export.",
        },
        {
          type: "tool_use",
          id: "t1",
          name: "Read",
          input: { file_path: "C:/dev/billing-service/src/invoices/page.tsx" },
        },
      ],
    },
  })
  say("s1", {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "export function InvoicesPage() { ... }",
        },
      ],
    },
  })
  say("s1", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t2",
          name: "TodoWrite",
          input: {
            todos: [
              {
                content: "Add the CSV export function",
                status: "completed",
                activeForm: "Adding the export",
              },
              {
                content: "Add a Download CSV button",
                status: "in_progress",
                activeForm: "Adding the button",
              },
              {
                content: "Write tests for the export",
                status: "pending",
                activeForm: "Writing tests",
              },
            ],
          },
        },
      ],
    },
  })
  say("s1", {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }] },
  })
  say("s1", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t3",
          name: "Bash",
          input: { command: "npm test -- invoices", description: "Run the invoice tests" },
        },
      ],
    },
  })
  say("s1", {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t3",
          content: "Test Files  3 passed (3)\n     Tests  14 passed (14)",
        },
      ],
    },
  })
  say("s1", {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "The export works and the tests pass. I'd like to add the customer and the issue date to each row, and then push the branch so you can open a pull request.",
        },
      ],
    },
  })
  say("s2", {
    type: "user",
    message: { role: "user", content: "Tables in the docs don't render. Fix it." },
  })
  say("s2", {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "The markdown renderer has no GitHub table support. Adding **remark-gfm** fixes it; that needs a package install, which is waiting for you.",
        },
      ],
    },
  })
}

useStore.setState({
  conn: "open",
  hasToken: true,
  sessions: {},
  pending: {},
  resolved: {},
  transcripts: {},
  setupDone: true,
  theme,
})
useStore.getState().handleEvent({
  type: "hello",
  sessions,
  pending,
  health: {
    approver: { state: "up", errors: [] },
    relay: { state: "connected", devices: 1 },
    signin: {
      signedIn: true,
      email: "alex@example.com",
      organization: "Example Ltd",
      managedPolicy: "detected",
      orgOk: true,
    },
    killSwitch: { engaged: false, approverConfirmed: true },
    pwsh: { running: true },
  },
  usage: {},
})
transcript()
useStore.getState().setUpdate(UPDATE)

// The stand-in for the Host's WebSocket: answers the commands screens send by themselves (earlier sessions, search,
// the context meter). Events still come from handleEvent above.
const HISTORY = [
  {
    sessionId: "h1",
    title: "Move the invoice emails to the new template",
    cwd: "C:/dev/billing-service",
    lastModified: now - 26 * 3_600_000,
    meta: { pinned: true },
  },
  {
    sessionId: "h2",
    title: "Why does the docs build take four minutes?",
    cwd: "C:/dev/docs-site",
    lastModified: now - 3 * 86_400_000,
    meta: {},
  },
  {
    sessionId: "h3",
    title: "Add a dry run to the backup script",
    cwd: "C:/dev/infra-scripts",
    lastModified: now - 9 * 86_400_000,
    meta: {},
  },
]
const CONTEXT = {
  totalTokens: 61_400,
  maxTokens: 200_000,
  percentage: 30.7,
  categories: [
    { name: "Messages", tokens: 38_900, kind: "used" },
    { name: "System tools", tokens: 12_100, kind: "used" },
    { name: "System prompt", tokens: 6_200, kind: "used" },
    { name: "Memory files", tokens: 4_200, kind: "used" },
    { name: "Free space", tokens: 138_600, kind: "free" },
  ],
}
function answer(command: { type: string; query?: string }): unknown {
  if (command.type === "list_history") return HISTORY
  if (command.type === "context_usage") return CONTEXT
  if (command.type === "search_history")
    return {
      complete: true,
      hits: HISTORY.slice(0, 1).map((h) => ({
        ...h,
        snippets: [`... send the ${command.query ?? ""} with the new template ...`],
      })),
    }
  return {}
}
class DemoSocket {
  static readonly OPEN = 1
  readyState = 1
  onopen?: () => void
  onmessage?: (m: { data: string }) => void
  onclose?: () => void
  constructor() {
    setTimeout(() => this.onopen?.(), 0)
  }
  send(raw: string) {
    const { cmdId, command } = JSON.parse(raw) as { cmdId: string; command: { type: string } }
    const data = answer(command)
    setTimeout(
      () => this.onmessage?.({ data: JSON.stringify({ type: "reply", cmdId, ok: true, data }) }),
      120,
    )
  }
  close() {}
}
window.WebSocket = DemoSocket as unknown as typeof WebSocket
sessionStorage.setItem("gatehouse.token", "demo")
startConnection()
if (view === "workspace")
  useStore.setState({ route: "workspace", selectedSession: "s1", panes: ["s1", "s2"] })
else if (view === "settings") useStore.setState({ route: "settings" })
else if (view === "policy") useStore.setState({ route: "policy" })
else if (view === "sessions") useStore.setState({ route: "sessions" })
else if (view === "usage") useStore.setState({ route: "usage" })
else if (view === "dashboard") useStore.setState({ route: "dashboard" })
else useStore.setState({ route: "approvals", selectedRequest: "r1" })
for (const r of ["r1", "r2", "r3"]) useStore.getState().markSeen?.(r)

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div className="h-full">
      <App />
    </div>
  </StrictMode>,
)

// Views that need a click or a scroll once the page is up.
setTimeout(() => {
  if (view === "update")
    [...document.querySelectorAll(".rail button")]
      .find((b) => b.textContent?.startsWith("Update"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  if (view === "settings")
    [...document.querySelectorAll("legend")]
      .find((l) => l.textContent === "Updates")
      ?.scrollIntoView({ block: "start" })
  document.body.dataset.ready = "1"
}, 800)
