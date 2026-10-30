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
- A permission request has **Deny** and **Allow once** on its row, so you can decide it without opening it. Open it to read everything first, or to answer a question or a plan.

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
- **Accept edits**: file edits inside the folder go ahead without asking. Commands still go through the rules, and what your rules deny is denied.
- **Plan**: Claude explores and proposes a plan before it changes anything. You approve the plan.
- **Auto**: Claude Code's own check decides routine actions, so far fewer wait for you. JCVC still denies what your rules deny, and still asks you about anything your rules rate High or Severe, or that it could not decide. Moderate and Low requests, and commands your rules do not name, are left to Claude Code's check. Turn on the rule library's packs to rate more commands.
- **Extreme approval**: everything that would wait for you is approved straight away, written to the audit log, and your phone is told. The floor, the rules' denies and the kill switch still block. A request JCVC could not check (the Approver did not answer, or the audit could not be written) still waits for you, and its card says so.

**A new project**: once Settings says where new projects go, leave Folder empty and say what you want to build. JCVC names a new folder from it (Change the name if you like), makes it a git repository so checkpoints work from the first edit, starts the session there and sends what you typed as your first prompt.

Starting a session starts Claude Code itself. The Start button counts the seconds; the first start after JCVC is installed or updated can take a minute or more.

In every mode the floor (secrets, destructive commands) is checked first and every decision is audited. Bypass permissions is never offered.

**The list**

Sessions waiting on you are lit and come first. Each has a code and colour that also appear on the board and in the workspace. Choose **Open** to work in a session.

**Earlier sessions**

Sessions from before JCVC last started, and Claude Code sessions from elsewhere on this computer. **Resume** carries one on where it stopped; **Fork** starts a copy and leaves the original as it was. Its ... menu renames, pins, exports or archives it. **Search what was said** looks inside past conversations (your words and Claude's, not tool output); it reads up to 100 sessions and stops after 20 seconds, and says so if it stopped early. Archived sessions are left out unless you tick Show archived.`,
  },
  chat: {
    id: "chat",
    title: "Chats",
    body: `A chat is a conversation with Claude that is not about one of your projects: questions, explanations, ideas and writing.

- Say what you want to talk about and choose **Start the chat**. It opens like a session, and your chats are listed under **Chats** in the sidebar.
- Each chat gets a folder of its own in JCVC's data folder, outside your projects, and always runs in Plan mode: Claude can read and search, but never changes files or runs commands. Claude is told it is a chat.
- It can look things up on the web, as your choices in What Claude may do allow.
- To build something, start a coding session instead: New session in the sidebar.`,
  },
  workspace: {
    id: "workspace",
    title: "Workspace",
    body: `This is where you work with Claude in one session.

**The sidebar**

On the left: Needs you, New session, Search (Ctrl+K), the pages you pinned and More. Below them, your sessions, grouped by the folder they are in, with those that need you first. Choose one to open it; its ... button opens it beside the others or closes it. At the foot: how the Host, the Approver and the phone are, the kill switch, and your profile menu, which holds Settings, What Claude may do, the Approver, the audit log, Phone and notifications, the theme and help. Edit sidebar, under More, chooses which pages sit in it. Ctrl+B hides and shows it.

**At the top of a session**

- Its name opens a menu: show another session here, open one beside it, rename it, pin it to the top of the sidebar, export it as Markdown, close the pane, interrupt, close the session, or archive it (it stops and leaves the sidebar; Earlier sessions keeps it).
- Each message shows the time it arrived, and the date when it was not today.
- **Plan**, **Files**, **Changes**, **Terminal** and **Browser** open those panels beside the transcript. Choose the button again, Close or Esc to put one away. A chat has none of them.

**Under the prompt box**

- **Model**, **Effort** and **Mode** change for this session at once.
- **Interrupt** stops the current turn.

**The transcript**

Claude's replies appear in order. A run of tool calls folds into one line, such as "Ran 2 commands, read schema.ts"; choose it to see each call, what ran and its output.

While a turn runs, a line above the composer says what Claude is doing and for how long: thinking, writing a reply, writing a file (with the characters so far) or running a command, with the tokens written and how long since anything last arrived. A large file takes a while, because Claude writes all of it before JCVC can check it. After two minutes with nothing arriving and nothing waiting for you, it says the turn is possibly stuck; Interrupt stops it and keeps what was done.

**Side by side**

Open beside, in a session's name menu or its ... button in the sidebar, shows another session next to it; up to three fit. Each has its own transcript, files and composer. Close this pane removes one. When a pane is narrow, Plan and Files open over it, and an open file takes the transcript's place until you close it.

**Files**

Files lists what Claude made or changed in this session, and the whole folder as a tree. Choose a file to open it next to the transcript: code and text with line numbers, markdown formatted, pictures, and web pages shown as they look (choose Show the source to see the code). Show in Explorer opens the folder with the file selected. Open a local page shows a dev server running on this computer, such as http://localhost:5173. Files outside the session folder and secrets files are never shown.

**Changes**

What the session changed, file by file, since its first checkpoint (or one you choose), with each diff. **Undo** puts one file back as it was then, and **Undo all of these** puts them all back; JCVC saves a checkpoint first, so you can go back to how things were before the undo.

**Terminal**

Your own PowerShell commands in the session's folder, one at a time, with Up and Down for earlier ones. They do not go through the Approver, like a PowerShell window you open yourself, and each is written to the audit log first. A program that asks a question as it runs gets no answer: Stop ends it. The kill switch stops it too.

**The composer**

- The plus button adds files or photos (from anywhere; files outside the folder are copied into .jcvc/attachments in it, secrets never), mentions a folder, and lists the session's slash commands and skills, connectors and plugins.
- Paste or drop a picture and it shows as a thumbnail above the prompt box; choose it to see it large, or its cross to take it off. It is sent with your words, and your message shows it.
- **Context**, under the prompt box, says how full the conversation is; choose it to see what fills it. When it is nearly full, Claude Code summarises the older parts by itself.
- Enter sends. Shift+Enter adds a line.
- Type / for commands: /plan, /default, /accept-edits, /auto, /extreme, /effort high, /model, /stop and /close.
- When a request from this session is waiting, it appears above the composer with **Deny** and **Allow once** (Esc and Ctrl+Enter work while focus is inside it). More options opens the full card. A question or a plan shows in full there.

**Todo list**

The list on the right is Claude's own plan for the turn, ticked off as it goes.`,
  },
  policy: {
    id: "policy",
    title: "Policy",
    body: `The policy is the set of rules the Approver uses to decide requests. The page opens on **Your choices**: what Claude may do, in words.

- **Levels**: Careful (reads, and changes code, tests and docs), Balanced (for building an app: any file in your folders, git on this computer, building, testing, running your app and reading the web) and Hands-off (Balanced, and installing packages for your project). Sending code away and anything risky always ask.
- **Switches**: change one thing at a time, for example let Claude install packages without asking. Each change saves at once; Undo in the message puts it back.
- **Always blocked**: what no level or rule can allow.
- **Learned from you**: things you allowed three times or more, offered as one exact rule, and the answers you made permanent (Ask me again removes one).
- **Try it**: what would happen if Claude wanted to run a command, change or read a file, or open a page, and which choice decides it.

**Advanced** is the full studio, below.

- **Floor**: always blocked, whatever else says. Secrets, credentials and destructive commands live here. Nothing can lift these.
- **Allow and deny rules**: what is decided for you without asking.
- **Your remembered rules**: the narrow rules you added with Remember. Remove any you no longer want.

**Test a request** runs the live policy on what you type and shows which rule decided and why. Nothing runs and nothing is written to the audit log.

**Library** holds ready-made packs of rules (Git, Node, Python, .NET, Rust and Go, containers, cloud, editing, extra caution on Windows). Switch a pack on to use it, switch off a built-in allow or ask rule you do not want, or copy any rule into your own rules and change it. **Preview what changes** shows which past decisions would come out differently before you save. The floor and the deny rules always apply and cannot be switched off.

Rules are files on this computer. Changes are picked up straight away.`,
  },
  approver: {
    id: "approver",
    title: "Approver",
    body: `The Approver is the MCP server that decides each permission request. It runs on this computer next to JCVC and answers only JCVC, with a token that changes every time JCVC starts.

**Status**

- **State**: running, starting or not running. While it is not running, every request waits for you; nothing is allowed without it.
- **Policy**: the fingerprint of the rules it is using, how many rules you remembered, and any problems loading the rules.
- **PowerShell parser**: PowerShell commands are parsed by PowerShell itself. Without it they all wait for you.
- **Restart the Approver** stops and starts it through its supervisor. The restart is recorded in the audit log.

**Try a request**

Type a command, file or address and see what the Approver would decide, which rule decided and why. Nothing runs and nothing is written to the audit log.

**What it offers**

The tools it answers over MCP: deciding a request, explaining a rule, reporting its status, and the same decision for headless runs.

**What it decided lately**

Its last 25 decisions, newest first, with the rule, the reason and how long it took.`,
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
    body: `Get requests on your phone away from your desk, in one of two ways.

**Push notifications with ntfy** (works behind firewalls): switch it on, install the free ntfy app, and subscribe to the topic JCVC shows. Each request arrives with Approve and Deny buttons. Everything goes out from this computer and your answer comes back over a connection JCVC opens, so nothing has to reach in. A notification shows only the project, tool, risk and a short redacted summary. Each button works once, for that request, and Severe requests always need you at the desk. If your phone is subscribed to a different topic, choose **My phone has a different topic** and paste the one it has: JCVC takes only a topic it made. **Make new topics** asks first, because your phone stops getting requests until you subscribe to the new one.

**Push notifications with Slack** (also works behind firewalls): create a small Slack app from the manifest JCVC shows, give its two tokens and your member id, and requests arrive as messages with Approve and Deny buttons. Only your own taps count, and the tokens are kept encrypted on this computer.

**The iPhone app with a Relay** (strongest): you decide with Face ID or Touch ID and see the full request, encrypted end to end.

**Run the Relay inside JCVC** (simplest): give the https address your phone uses and choose Start the Relay. JCVC runs it only while JCVC is running, links itself to it, and starts it again each time JCVC starts. The address must reach port 8087 on this computer; Tailscale Funnel (the command tailscale funnel 8087) or a Cloudflare Tunnel can provide one.

**What you need**

1. The phone Relay running at a secure (https) address your phone can reach, inside JCVC or elsewhere.
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
    body: `Settings are saved on this computer, as you change them: a switch or a choice at once, a typed box when you leave it or press Enter. A short message confirms each save, or says what was wrong.

- **Expected organisation**: sessions only start when your Claude account belongs to it. This stops a personal account being used by mistake.
- **Where new projects go**: the folder a new project gets its own folder in, for example C:\\dev. It counts as a workspace folder. Restart JCVC after changing it.
- **Workspace roots**: the folders Claude may work in without extra checks.
- **Quiet hours**: hold phone notifications at night. Requests still wait on this computer.
- **Timeouts**: how long the phone can answer, and when an unanswered request is denied.
- **Daily digest**: a short summary sent to your phone each day.
- **Redaction list**: words replaced before anything is saved or sent, for example client names.
- **Checkpoints**: snapshots taken before risky steps so you can restore.
- **Updates**: the version you have, how often JCVC looks for a new one, skipped versions, and going back to the version before.
- **Background picture**: which faint Jean-Claude picture sits behind the screens, or your own.

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
    id: "relay-server",
    title: "Relay on your own server",
    body: `The strongest way to answer from your phone: the iPhone app with Face ID and the full request, encrypted end to end. The Relay runs on a server you own, and both this computer and your phone connect out to it, so nothing has to reach your laptop.

**What you need**

- A Linux server with Podman or Docker, and Caddy (or another web server that does https).
- A name for it, for example relay.your-domain, with its DNS pointing at the server.

**On the server**

1. Get the code:
   git clone https://github.com/breakmylegs/gatehouse.git jcvc
2. Install or update the Relay, with the address your phone will use:
   cd jcvc and then ./deploy/relay/install.sh https://relay.your-domain
3. Add this site to the server's Caddyfile and reload Caddy (Caddy gets the certificate itself):
   relay.your-domain { reverse_proxy 127.0.0.1:8087 }
4. The install prints a one-time enrolment token. Keep it for the next step.

**In JCVC**

1. Open Devices, then Or connect to a Relay you run elsewhere.
2. Give the address (https://relay.your-domain), the one-time token, and a name for this computer, then Connect.
3. Choose Add a phone and follow the steps on the iPhone.

**Updating** is the same install command again; paired phones are kept. The Relay only ever holds encrypted data, and every answer from the phone is checked here before it counts.`,
  },
  {
    id: "updates",
    title: "Updates",
    body: `You install JCVC once, with JCVC-Setup.exe. After that it keeps itself up to date.

**How it works**

1. Every 30 minutes (change it in Settings, Updates) JCVC looks for a new version on GitHub.
2. When there is one, an **Update to** button appears at the foot of the sidebar. It lists what is new.
3. Choose **Update now**. JCVC downloads only the parts that changed, checks them against its release signature, and builds the new version beside the one you are using. You can keep working while it does.
4. JCVC then closes, switches to the new version and opens again by itself, usually within a minute. Open sessions stop when it closes; resume them from Sessions.

With **Download a new version as soon as it is found** on (it is, unless you turn it off), step 3 has already happened by the time you see the button, so Update is quick. Nothing changes until you choose Update.

**Skipping and going back**

- **Skip this version** stops JCVC offering it. A newer one is still offered. You can offer a skipped version again in Settings.
- You can skip any number of versions and update straight to the newest: each version is complete, not a patch on the one before.
- The version before is kept beside the current one. **Go back** in Settings switches to it. If a new version does not start, JCVC goes back by itself and tells you.
- If JCVC will not open at all after an update, run **JCVC-Update.exe --rollback** from its folder (%LOCALAPPDATA%\\Programs\\JCVC).

**What stays yours**

Your settings, audit log and phone pairing live in your data folder and are never touched. Your rules (rules.yaml, rules.user.yaml, remembered decisions, project overlays) are carried to the new version; only the shipped rule library is replaced.

**Safety**

Each release is signed. JCVC refuses anything not signed with its release key, any download whose size or fingerprint does not match, and any address that is not GitHub's.`,
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
