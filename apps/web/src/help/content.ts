import type { Route } from "../store"

/**
 * The help that opens in the right-hand pane on every page, and the user guide built from the same articles. Written
 * as app content so nobody has to open a document in a folder. Plain UK English, second person.
 */
export interface Article {
  id: string
  title: string
  body: string
}

export const PAGE_HELP: Record<Route, Article> = {
  approvals: {
    id: "approvals",
    title: "Approvals",
    body: `This is the board of requests that need your decision. Everything the rules allow is decided for you and never appears here.

**Reading the board**

- Rows are oldest first, like departures. The time cell shows how long the request has waited.
- A row lit in yellow is new: you have not looked at it yet. It stops being lit once you open it.
- Each row shows the session code (for example AT 830), the project, what Claude wants to do and the risk.

**Deciding**

- The pass on the right shows exactly what will run, where, which rule held it and why.
- The highlighted part of the command is the part that caused the escalation.
- **Deny** is always one step. **Allow once** needs Ctrl+Enter or a click inside the pass, so you cannot allow by accident.
- At high risk (70 or more) Deny is the filled button and Allow becomes an outline.
- **Deny with message** tells Claude why, so it can try another way.
- **Edit then allow** lets you change the command first. The edited command is checked again by the floor and the rules, and a deny there blocks it.
- **Remember** adds one narrow rule to your own rules so the same request is allowed next time. It shows the exact rule first.
- **Stop session** denies and ends the session.

**Keyboard**

- Ctrl+Shift+A moves focus into the pass. Nothing else ever takes focus from what you are typing.
- Alt+Up and Alt+Down move between requests.
- Esc denies while focus is in the pass.

Your phone gets the same request at the same time if one is paired. The first valid answer wins.`,
  },
  sessions: {
    id: "sessions",
    title: "Sessions",
    body: `Start and manage Claude sessions here. Each session works in one folder.

**Starting a session**

- **Folder**: type a full path, or choose **Choose a folder...** to pick one in Windows. A folder that does not exist yet is created, with any missing parent folders.
- **Model**: the Claude model for the session. You can change it later in the workspace.
- **Effort**: how hard Claude thinks. Higher effort is more thorough but slower and uses your limits faster. Medium suits most work.
- **Mode**: how permission requests are handled (see below).

**Modes**

- **Manual**: anything the rules do not allow waits for you.
- **Accept edits**: file edits inside the folder go ahead without asking. Commands still go through the rules.
- **Plan**: Claude explores and proposes a plan before it changes anything. You approve the plan.
- **Auto**: Claude Code's own checks approve routine actions.
- **Extreme approval**: everything that would wait for you is approved straight away, written to the audit log, and your phone is told. The floor, the rules' denies and the kill switch still block.

In every mode the floor (secrets, destructive commands) is checked first and every decision is audited. Bypass permissions is never offered.

**The list**

Sessions waiting on you are lit and come first. Each has a code and colour that also appear on the board and in the workspace. Choose **Open** to work in a session.`,
  },
  workspace: {
    id: "workspace",
    title: "Workspace",
    body: `This is where you work with Claude in one session.

**At the top**

- The session code and picker switch between sessions.
- **Model**, **Effort** and **Mode** change for this session at once.
- **Interrupt** stops the current turn.

**The transcript**

Claude's replies, the tools it used and their results appear in order. Tool calls show what ran and whether it was allowed.

**The composer**

- Enter sends. Shift+Enter adds a line.
- Type / for commands: /plan, /default, /accept-edits, /auto, /extreme, /effort high, /model, /stop and /close.
- When a request from this session is waiting, a yellow bar above the composer takes you to it.

**Todo list**

The list on the right is Claude's own plan for the turn, ticked off as it goes.`,
  },
  policy: {
    id: "policy",
    title: "Policy",
    body: `The policy is the set of rules the Approver uses to decide requests.

- **Floor**: always blocked, whatever else says. Secrets, credentials and destructive commands live here. Nothing can lift these.
- **Allow and deny rules**: what is decided for you without asking.
- **Your remembered rules**: the narrow rules you added with Remember. Remove any you no longer want.

**Test a request** runs the live policy on what you type and shows which rule decided and why. Nothing runs and nothing is written to the audit log.

Rules are files on this computer. Changes are picked up straight away.`,
  },
  audit: {
    id: "audit",
    title: "Audit log",
    body: `Every decision is recorded here: automatic ones, yours, your phone's, timeouts and Extreme approval.

- Filter by decision, channel, rule or text.
- Each record shows the tool, the input (with secrets and your redaction list hidden), the rule and who decided.
- The log is a hash chain, so a changed or deleted record shows up. The chain is checked when you open this page, and **Check again** checks it once more.
- Export saves the filtered records to a file.

The log lives in your JCVC data folder and never leaves this computer.`,
  },
  devices: {
    id: "devices",
    title: "Devices",
    body: `Pair an iPhone so requests reach you away from your desk. You decide with Face ID or Touch ID.

**What you need**

1. The phone Relay running at a secure (https) address your phone can reach.
2. An iPhone with iOS 16.4 or newer.
3. The Relay's one-time enrolment token, to connect this computer to it.

**Pairing**

- Choose **Show a pairing code**, open the Relay address in Safari on the phone, then Share and Add to Home Screen. Open JCVC from the Home Screen and type the code.
- Notifications only work for the Home Screen app.

**Security**

The Relay only ever carries encrypted data. Your phone signs every answer, and this computer checks the signature, that it is fresh and that it matches the request, before it counts. Revoke a phone here and its answers are refused at once.`,
  },
  settings: {
    id: "settings",
    title: "Settings",
    body: `Settings are saved on this computer.

- **Expected organisation**: sessions only start when your Claude account belongs to it. This stops a personal account being used by mistake.
- **Workspace roots**: the folders Claude may work in without extra checks.
- **Quiet hours**: hold phone notifications at night. Requests still wait on this computer.
- **Timeouts**: how long the phone can answer, and when an unanswered request is denied.
- **Daily digest**: a short summary sent to your phone each day.
- **Redaction list**: words replaced before anything is saved or sent, for example client names.
- **Checkpoints**: snapshots taken before risky steps so you can restore.
- **Jean-Claude mode**: an optional faint picture behind the screens.

Some changes apply at once; others say a restart is needed.`,
  },
  "first-run": {
    id: "first-run",
    title: "Before you start",
    body: `JCVC checks four things before a session can run: that you are signed in to Claude, that your account belongs to the expected organisation, whether managed settings are in force (information only), and that the Approver is running.

Use the sign-in buttons to sign in through Anthropic's own page in your browser. JCVC never sees your password. Then set your organisation and choose **Check again**.`,
  },
  guide: {
    id: "guide",
    title: "User guide",
    body: "The full guide to JCVC. Pick a topic on the left.",
  },
  setup: {
    id: "setup",
    title: "Setup",
    body: `The setup wizard runs the first time you open JCVC. It signs you in, checks your organisation, offers phone alerts, and lets you choose a theme. You can skip it and run it again from Settings.`,
  },
}

export const GUIDE: Article[] = [
  {
    id: "what",
    title: "What JCVC does",
    body: `JCVC runs Claude sessions on your computer and keeps you in charge of what they do.

Claude asks permission before it runs a command, edits a file or uses a tool. JCVC's Approver answers most of those requests for you using rules: safe reads and routine commands are allowed, dangerous ones are denied. Only the few it cannot be sure about wait for you, on this computer and on your phone at the same time.

Every decision, automatic or yours, is written to a tamper-evident audit log.`,
  },
  {
    id: "start",
    title: "Getting started",
    body: `1. **Sign in.** JCVC uses your own Claude account. Use the sign-in buttons in the setup wizard; your browser opens Anthropic's page.
2. **Set your organisation.** Type the organisation your account belongs to (it is shown on the sign-in check).
3. **Start a session.** On Sessions, choose a folder, a model, an effort and a mode, then Start. Try a scratch folder first.
4. **Work in the workspace.** Give Claude a task. Watch the board for anything that needs you.`,
  },
  {
    id: "decisions",
    title: "How decisions are made",
    body: `Each request goes through three layers, in this order:

1. **The floor.** A fixed list of things that are always blocked: reading secrets and credentials, destructive commands, writing outside your folders. Nothing can allow these.
2. **The rules.** Allow and deny rules, including the ones you remembered. Commands are parsed properly, so a safe command hiding a dangerous one is caught.
3. **You.** Anything left waits for you, with the exact command, the rule that held it and why.

If anything goes wrong while deciding, the request waits for you or is denied. It is never allowed by mistake.`,
  },
  ...Object.values(PAGE_HELP).filter(
    (a) => a.id !== "setup" && a.id !== "first-run" && a.id !== "guide",
  ),
  {
    id: "phone",
    title: "Phone alerts",
    body: PAGE_HELP.devices.body,
  },
  {
    id: "trouble",
    title: "Troubleshooting",
    body: `- **A session will not start and mentions the organisation.** Open Settings and set the expected organisation to the one shown on the sign-in check, then Check again.
- **The folder does not exist.** JCVC creates it for you. A relative path, a file or a missing drive is refused with a message saying which.
- **Nothing appears on the board.** Good: everything is being decided automatically. The audit log shows each decision.
- **Not connected to the Host.** JCVC reconnects by itself. Requests keep waiting and nothing is decided while it is disconnected.
- **The kill switch is engaged.** Every request is denied until you choose Re-arm.`,
  },
]
