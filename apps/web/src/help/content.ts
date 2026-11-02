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
- **Deny** is always one step. **Allow once** needs Ctrl+Enter or a click inside the card, so you cannot allow by accident. At High and Severe risk a red band says so and Deny is the filled button.
- While focus is inside the card, one letter does what its button says: **D** denies, **M** opens Deny with message, **E** Edit then allow, **R** Remember, **Shift+S** Stop session. No letter ever allows, and letters typed in a box are only words.
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

- **Manual**: anything the rules do not allow waits for you. Every call is checked by the Approver, even one Claude Code or a plugin would allow by itself, so nothing gets past your rules.
- **Accept edits**: file edits inside the folder go ahead without asking. Commands still go through the rules, and what your rules deny is denied.
- **Plan**: Claude explores and proposes a plan before it changes anything. You approve the plan.
- **Auto**: Claude Code's own check decides routine actions, so far fewer wait for you. Codehouse still denies what your rules deny, and still asks you about anything your rules rate High or Severe, or that it could not decide. Moderate and Low requests, and commands your rules do not name, are left to Claude Code's check. Turn on the rule library's packs to rate more commands.
- **Extreme approval**: everything that would wait for you is approved straight away, written to the audit log, and your phone is told. The floor, the rules' denies and the kill switch still block. A request Codehouse could not check (the Approver did not answer, or the audit could not be written) still waits for you, and its card says so. Extreme approval never waits on you otherwise: a question Claude asks gets its recommended answer, a plan is approved, and when a turn ends with work left the session carries on with its build queue by itself, until Claude says the queue is empty. It stops at the limits in Settings, Extreme approval (by default 200 automatic turns or $500 since your last message; either can be No limit), when two turns in a row do no work, when a turn fails, and when you press Stop. A session that was working when Codehouse closed, in any mode, carries on where it was when Codehouse opens again. Each automatic answer and turn is in the audit log and the transcript.

**A new project**: once Settings says where new projects go, leave Folder empty and say what you want to build. Codehouse names a new folder from it (Change the name if you like), makes it a git repository so checkpoints work from the first edit, starts the session there and sends what you typed as your first prompt.

Starting a session starts Claude Code itself. The Start button counts the seconds; the first start after Codehouse is installed or updated can take a minute or more.

In every mode the floor (secrets, destructive commands) is checked first and every decision is audited. Bypass permissions is never offered.

**The list**

Sessions waiting on you are lit and come first. Each has a code and colour that also appear on the board and in the workspace. Choose **Open** to work in a session.

**Ended sessions in the sidebar** are hidden by default, so the list shows what is working or needs you. A line at the bottom says how many are hidden and **Show** brings them back. The ... menu above the list switches this on or off, and **Archive all ended** puts every ended session away at once; they stay under Earlier sessions. A session that stopped with an error is never hidden, and neither is an ended one you have open.

**Earlier sessions**

Sessions from before Codehouse last started, and Claude Code sessions from elsewhere on this computer. **Resume** carries one on where it stopped; **Fork** starts a copy and leaves the original as it was. Its ... menu renames, pins, exports or archives it. **Search what was said** looks inside past conversations (your words and Claude's, not tool output); it reads up to 100 sessions and stops after 20 seconds, and says so if it stopped early. Archived sessions are left out unless you tick Show archived.`,
  },
  chat: {
    id: "chat",
    title: "Chats",
    body: `A chat is a conversation with Claude that is not about one of your projects: questions, explanations, ideas and writing.

- Say what you want to talk about and choose **Start the chat**. It opens like a session, and your chats are listed under **Chats** in the sidebar.
- Each chat gets a folder of its own in Codehouse's data folder, outside your projects, and always runs in Plan mode, so nothing on your computer changes.
- **Research**: tick it when you start a chat and Claude plans the questions, searches the web, reads the best sources in full and puts a numbered citation after each claim. **Sources** at the top of any chat lists every search result it was shown and every page it read, numbered as Claude cites them, each opening in your browser and marked as from the web and untrusted. A search or web address that contains a term on your redaction list (Settings, Privacy) is refused before it leaves this computer, and Claude is asked to try again without it.
- **Artifacts**: ask a chat for a page, a chart or a small tool and it can make one to show you. Each one shows as a card in the reply that made it, with **Open**; **Artifacts** at the top of the chat opens them all, newest first. Each save is a new version: choose a version, **Compare with the one before** to see what changed, or **Export** it as a file. An artifact runs in a sandbox: it can run its own scripts, but it cannot reach the internet, read your files, open windows or change Codehouse.
- To keep instructions and files for a set of chats, make a project (Projects in the sidebar menu, or the sidebar if you pinned it) and choose it when you start a chat.
- A chat is plain Claude: it has its own short instructions, not the coding ones, and reads none of your projects' notes or settings. The only tools it has are searching the web, reading a web page and reading files, as your choices in What Claude may do allow; it cannot change a file or run anything. **Attach a file** with + or by dropping it on the prompt box (a CSV, a PDF, a picture or a text file): it is copied into the chat's own folder and Claude reads it there. Ask for a chart of a CSV and Claude makes it as an artifact. A secrets file is never attached, and files over 20 MB are left out. Reading a file outside the chat's folder goes to the Approver, as it would in a coding session.
- **Starting quickly:** while Start a chat (or the quick prompt) is open, Codehouse has a chat ready in the background, so your first message does not wait for Claude Code to start. It is a chat like any other, with the same checks, and it is put away after three minutes unused, or straight away when the computer is short of memory. A chat in a project, a research chat or one with another model starts as before.
- A chat is named from your first message (with your redaction list applied before the name is kept). Rename it as you like.
- To build something, start a coding session instead: New session in the sidebar.`,
  },
  marketplace: {
    id: "marketplace",
    title: "Marketplace",
    body: `Plugins from the marketplaces Claude Code knows on this computer: what each one holds (skills, commands, agents, hooks, servers) and whether Codehouse will install it.

- A plugin is someone else's code. Codehouse installs only one whose files it can read before installing, and never one with **hooks** (they run commands without asking the Approver), **MCP or language servers** (programs that run outside the session), or other plugins it brings with it. A plugin on GitHub or the web cannot be read first, so it is listed but not installed.
- **Install** asks you first, then Claude Code installs it for your main account. Codehouse reads the installed copy again and removes it at once if it holds anything refused. Coding sessions you start afterwards have it; chats load no plugins.
- **Remove** takes it away again. Every install, removal and refusal is in the audit log.`,
  },
  prompts: {
    id: "prompts",
    title: "Prompts",
    body: `Prompts you use again, kept on this computer (with your redaction list applied, as memory is).

- **Add** one with a title and its words. Write {{name}} for a blank: when you use the prompt, Codehouse asks for each one.
- **Use** one from **+** beside any prompt box, under **Saved prompts**. It goes into the prompt box for you to read and send.
- **Make it a skill in** a running session's project writes it as a Claude Code skill in that project's skills folder, so Claude can use it there by name. An existing skill is never overwritten, and each one made is in the audit log.`,
  },
  memory: {
    id: "memory",
    title: "Memory",
    body: `Memory is what chats remember about you, so you do not have to say it again.

- A chat starts knowing everything kept for every chat, and everything kept for its project if it is in one. Claude can keep a short fact or preference (the **remember** tool), look it up, and forget it, and it is told to do that only when you ask or it will clearly help, and never for a secret.
- Everything is here to read. **Edit** changes one, **Forget** removes one, and **Keep something** adds your own. Entries are kept by topic.
- **Export as Markdown** saves it all as a file you can read and keep. **Import from Markdown** adds what is not already here.
- Memory is redacted with your redaction list before it is written, and each change, by you or by Claude, is recorded in the audit log by its id and topic, never by what it says.
- Claude Code's own automatic memory is switched off in chats, so this is the only memory to look after. Coding sessions do not use it.`,
  },
  projects: {
    id: "projects",
    title: "Projects",
    body: `A project gathers what a set of chats should know, so you do not repeat it each time.

- **Make the project** from a name. Choose it in the list to see it.
- **Instructions** are your own words, for every chat in the project: how you like answers, what the project is, what to avoid. They save when you leave the box.
- **Knowledge files** are notes, documents or data that Claude may read when they are relevant. **Add files** copies them into Codehouse's data folder; **Remove** takes one out, and chats in the project stop using it from their next message.
- **Start a chat in this project** opens the new chat page with the project chosen. The chat is told your instructions for every chat (Settings, Sessions), the project's, and the ones you give for that chat, in that order.
- Each file a chat reads shows in the conversation as a Read marked Project knowledge.
- Changes here are recorded in the audit log by name and size, never by what they say. Removing a project deletes its files.`,
  },
  workspace: {
    id: "workspace",
    title: "Workspace",
    body: `This is where you work with Claude in one session.

**The sidebar**

On the left: Needs you, New session, Search (Ctrl+K), the pages you pinned and More. Below them, your sessions, grouped by the folder they are in, with those that need you first. Choose one to open it; its ... button opens it beside the others or closes it. At the foot: how the Host, the Approver and the phone are. Across the top, the command deck: every live session with its state (choose one to open it), whether your phone is being told, the kill switch, and your profile menu, which holds Settings, What Claude may do, the Approver, the audit log, Phone and notifications, the theme and help. The kill switch, **Stop everything**, asks once before it acts; **Ctrl+Shift+K** opens that question and Esc closes it. Edit sidebar, under More, chooses which pages sit in it. Ctrl+B hides and shows it.

**At the top of a session**

- Its name opens a menu: show another session here, open one beside it, rename it, pin it to the top of the sidebar, export it as Markdown, close the pane, stop, close the session, or archive it (it stops and leaves the sidebar; Earlier sessions keeps it).
- Each message shows the time it arrived, and the date when it was not today.
- **Plan**, **Files**, **Changes**, **Terminal** and **Browser** open those panels beside the transcript. Choose the button again, Close or Esc to put one away. A chat has none of them.

**Under the prompt box**

- **Model**, **Effort** and **Mode** change for this session at once.
- **Resources** limits how much of this computer the session may use, at once, for it and for every command it runs: **High** has no limits; **Medium** half the processor and 4 GB of memory; **Low** a fifth of the processor and 2 GB. Medium and Low also give way to what you are doing. The limit is shared: however many commands the session runs at once, together they get no more. Each choice says its limits in the list, and a note beside it says what the chosen one means. A command that needs more memory than that fails, so choose High for big builds. It is offered where Codehouse can set limits, which is Windows.
- **Stop** stops the session there and then: the turn, and any subagents or commands still working in the background. If it is still working a few seconds later, **Force stop** ends its Claude process and starts it again on the same conversation, in the same pane.
- When a turn has ended but subagents or commands are still working, the session says **Working in the background** and lists them.
- A message you send while Claude works is **queued**: Claude reads it at its next step, between one action and the next, without stopping. It says Queued until Claude has it, and it cannot be taken back. **Interrupt now** beside it stops the turn, and Claude reads your message straight away.

**The transcript**

Claude's replies appear in order. A run of tool calls folds into one line, such as "Ran 2 commands, read schema.ts"; choose it to see each call, what ran and its output.

Each call says why it ran or did not, for example "Allowed by your rules: Reading files inside this project." A call that asked you or was stopped also says so on its top line (You allowed, Blocked, Not answered), and a folded run says how many were blocked. Change what Claude may do, under a call your rules or the judge decided, opens the rules.

While a turn runs, a line above the composer says what Claude is doing and for how long: thinking, writing a reply, writing a file (with the characters so far) or running a command, with the tokens written and how long since anything last arrived. A large file takes a while, because Claude writes all of it before Codehouse can check it. After two minutes with nothing arriving and nothing waiting for you, it says the turn is possibly stuck; Interrupt stops it and keeps what was done.

**Side by side**

Open beside, in a session's name menu or its ... button in the sidebar, shows another session next to it; up to four fit, two by two when there are four. The pane you last clicked or typed in has focus, marked by a line along its top: choosing a session in the sidebar that is not on screen shows it in that pane, and one already on screen just takes focus. Each has its own transcript, files and composer. Close this pane removes one. When a pane is narrow, Plan and Files open over it, and an open file takes the transcript's place until you close it.

**Files**

Files lists what Claude made or changed in this session, and the whole folder as a tree. Choose a file to open it next to the transcript: code and text with line numbers, markdown formatted, pictures, and web pages shown as they look (choose Show the source to see the code). Show in Explorer opens the folder with the file selected. Open a local page shows a dev server running on this computer, such as http://localhost:5173. Files outside the session folder and secrets files are never shown.

**Changes**

What the session changed, file by file, since its first checkpoint (or one you choose), with each diff. **Undo** puts one file back as it was then, and **Undo all of these** puts them all back; Codehouse saves a checkpoint first, so you can go back to how things were before the undo.

**Terminal**

Your own PowerShell commands in the session's folder, one at a time, with Up and Down for earlier ones. They do not go through the Approver, like a PowerShell window you open yourself, and each is written to the audit log first. A program that asks a question as it runs gets no answer: Stop ends it. The kill switch stops it too.

**The composer**

- The plus button adds files or photos (from anywhere; files outside the folder are copied into .codehouse/attachments in it, secrets never), mentions a folder, and lists the session's slash commands and skills, connectors and plugins.
- Paste or drop a picture and it shows as a thumbnail above the prompt box; choose it to see it large, or its cross to take it off. It is sent with your words, and your message shows it.
- **Drop any file** on the prompt box, or anywhere on its row: it is copied into .codehouse/attachments in the session's folder and mentioned in your prompt, as Add files does. A file the policy blocks, such as .env or a key, is refused and never copied, and anything over 20 MB is left out. The row is outlined while you hold a file over it.
- **Exporting.** **Export...** in a session's menu, the sidebar's ... menu or Earlier sessions reads the whole conversation, from its start, and shows a preview with the words on your redaction list (Settings, Privacy) and anything that looks like a secret masked. What you see is exactly what is saved: Markdown, a web page, or a PDF through the print window (choose Save as PDF there). Each export is in the audit log.
- **Copying.** Every message has **Copy** under it: Claude's replies paste as Markdown into a plain editor and with their formatting into Word or Outlook. Each code block has its language and its own Copy, and so does a command, what it printed, a path, a plan, the command on a request card and an error. **Edit** under a message you sent puts it in the prompt box to change and send again. **Copy conversation** in the session menu copies the whole conversation. **Ctrl+Shift+C** copies Claude's last reply and **Ctrl+Shift+;** its last code block. You can also select any text and press Ctrl+C, or right-click and choose Copy.
- **The conversation follows new output.** While you are at the end it stays at the end as Claude writes, as pictures load and as lines grow. Scroll up to read and it stays where you are; a round arrow button appears at the bottom, and choosing it takes you back to the latest.
- **Theme**: with no choice of yours kept, Codehouse follows the Windows light or dark theme and changes with it while it runs. Choose Codehouse light or dark in the profile menu to keep one; **Follow Windows theme** there goes back. Windows high contrast is followed too: every colour becomes the one you set in Windows.
- **Keys and the command list.** **Ctrl+K** opens a list of everything the menus can do, besides the pages, your sessions and the requests waiting on you; the page you are on comes first, under On this page. **Ctrl+/** shows every key Codehouse answers to. **Ctrl+1** to **Ctrl+9** show the first to ninth session in the sidebar, counting from the top as it is listed. In Edit sidebar, **Up** and **Down** set the order of the pages in the sidebar; the order is kept. The list never decides a request for you: that is done on its card.
- **How much shows**: in a pane's title menu, **Summary** keeps what you and Claude said, errors, the lines that say why, and any tool call that was refused or is waiting on you; **Normal** folds each run of work into one line; **Verbose** opens every tool call and Claude's thinking. Each session keeps its own. On a line of work, **Right** opens it, **Left** closes it, and **Up** and **Down** move to the line before or after. A screen reader hears, once each and without interrupting, when a new request is waiting and when a turn finishes.
- **Looking after your eyes**: drag the edge of the sidebar to make it wider or narrower (200 to 480 pixels; the arrow keys work too, and a double click puts it back). In a pane's title menu, **Larger text**, **Smaller text** and **Compact spacing** change that session alone and are kept for it. **Hide settings** under the prompt box folds the model, effort and mode row away in every pane, and shortens the line that says what Claude is doing; **Show model and settings** brings them back. Folders you fold in the sidebar stay folded.
- **Paused**: when the plan's 5-hour limit reaches 95%, Codehouse pauses every session on that account, so a turn is not lost to the limit mid-way. A paused session shows Paused in the sidebar and above the prompt box, with the time the limit resets. It starts again by itself at the reset and carries on where it stopped if it was working. **Start now** starts one earlier, and so does sending it a message. Each pause and each start is in the audit log. The numbers come from Claude Code's own usage figures; if they cannot be read, nothing is paused.
- **Plan usage**, the small ring beside Stop, shows how much of your plan's 5-hour limit is used; choose it for every limit, the weekly ones and extra usage, with **Refresh**. It shows a dash until Claude Code has given the numbers, and asks again every 20 seconds until it has. A line missing from a later answer keeps its last known value. Clicking anywhere else or pressing Esc closes it.
- **Context**, under the prompt box, always says how full the conversation is (a dash until it can be read, asked again every 15 seconds); choose it to see what fills it. **Compact now** summarises the older parts; while Claude is working it reads **Compact after this turn**, and compacts as soon as the turn ends (Stop calls it off). From about 60% the meter says Compact, because Claude keeps the thread better with room to work; from 80% it is pressing. When it is nearly full, Claude Code summarises the older parts by itself, at a moment it chooses.
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

- **Levels**: Careful (reads, and changes code, tests and docs), Balanced (for building an app: any file in your folders, git on this computer, building, testing, running your app and reading the web) and Hands-off (Balanced, and installing packages for your project). Sending code away and anything risky always ask. Under each level: up to five everyday requests it lets Claude do by itself and five it asks you about, worked out by the real rules for that level in a project inside your first workspace folder.
- **Switches**: change one thing at a time, for example let Claude install packages without asking. Each change saves at once; Undo in the message puts it back.
- **Always blocked**: what no level or rule can allow.
- **Learned from you**: things you allowed three times or more, offered as one exact rule, and the answers you made permanent (Ask me again removes one).
- **Try it**: what would happen if Claude wanted to run a command, change or read a file, or open a page, and which choice decides it, with your choices now or with any level. Trying a level saves nothing.

**Advanced** is the full studio, below.

- **Floor**: always blocked, whatever else says. Secrets, credentials and destructive commands live here. Nothing can lift these.
- **Allow and deny rules**: what is decided for you without asking.
- **Your remembered rules**: the narrow rules you added with Remember. Remove any you no longer want.

**Test a request** runs the live policy on what you type and shows which rule decided and why. Nothing runs and nothing is written to the audit log.

**Library** holds ready-made packs of rules (Git, Node, Python, .NET, Rust and Go, containers, cloud, editing, extra caution on Windows). Switch a pack on to use it, switch off a built-in allow or ask rule you do not want, or copy any rule into your own rules and change it. **Preview what changes** shows which past decisions would come out differently before you save. The floor and the deny rules always apply and cannot be switched off.

Rules are files on this computer. Changes are picked up straight away.`,
  },
  dashboard: {
    id: "dashboard",
    title: "Dashboard",
    body: `Everything that matters now, on one page, each with the place to act on it.

- **Not right**: only when something is wrong, such as the Host or the Approver not running, the kill switch on, a sign-in problem, requests not reaching your phone, a session that stopped with an error, or an update waiting.
- **What needs your attention now**: the oldest request waiting for you as its full card, with every action and its keys, and the next few on one line each, all decided in place, as on Approvals.
- **Today**: what was spent and written today, how many sessions are working, and how often Codehouse asked you in the last 24 hours. Usage has the detail.
- **Live sessions**: a tile for each open session: its code and state, the risk of a request it is waiting on, what it is doing now, how long it has been open and what it has cost. Open shows it in the workspace.
- **Lately** (beside the rest on a wide window): what Claude told you, turns that finished or failed, and Extreme approval runs that ended, newest first, since this window opened.`,
  },
  usage: {
    id: "usage",
    title: "Usage",
    body: `What your sessions spent and how many tokens they used, as Claude Code reports it after each turn.

**Filters**, in one row at the top, cut everything below them: the dates (today, or the last 7, 30 or 90 days), a project, a session and a model.

- The tiles give the cost, input and output tokens and turns for what you chose. Turns are not kept by model, so with a model chosen they are not counted.
- **Cost by day** has a column for each day; point at one, or move to it with Tab, for its cost and tokens.
- **By project**, **By model** and **By session** list the largest first.
- **Show as a table** under each one gives the same figures as rows.

**Last 24 hours** says what went through automatically and what asked you.

Before this version Codehouse kept only a total for each day. Those days count in the totals and by day, not by project, model or session, and the page says so.`,
  },
  approver: {
    id: "approver",
    title: "Approver",
    body: `The Approver is the MCP server that decides each permission request. It runs on this computer next to Codehouse and answers only Codehouse, with a token that changes every time Codehouse starts.

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

The log lives in your Codehouse data folder and never leaves this computer.`,
  },
  devices: {
    id: "devices",
    title: "Devices",
    body: `Get requests on your phone away from your desk, in one of two ways.

**Push notifications with ntfy** (works behind firewalls): switch it on, install the free ntfy app, and subscribe to the topic Codehouse shows. Each request arrives with Approve and Deny buttons. Everything goes out from this computer and your answer comes back over a connection Codehouse opens, so nothing has to reach in. A notification shows only the project, tool, risk and a short redacted summary. Each button works once, for that request, and Severe requests always need you at the desk. If your phone is subscribed to a different topic, choose **My phone has a different topic** and paste the one it has: Codehouse takes only a topic it made. **Make new topics** asks first, because your phone stops getting requests until you subscribe to the new one.

**Push notifications with Slack** (also works behind firewalls): create a small Slack app from the manifest Codehouse shows, give its two tokens and your member id, and requests arrive as messages with Approve and Deny buttons. Only your own taps count, and the tokens are kept encrypted on this computer.

**The iPhone app with a Relay** (strongest): you decide with Face ID or Touch ID and see the full request, encrypted end to end.

**Run the Relay inside Codehouse** (simplest): give the https address your phone uses and choose Start the Relay. Codehouse runs it only while Codehouse is running, links itself to it, and starts it again each time Codehouse starts. The address must reach port 8087 on this computer; Tailscale Funnel (the command tailscale funnel 8087) or a Cloudflare Tunnel can provide one.

**What you need**

1. The phone Relay running at a secure (https) address your phone can reach, inside Codehouse or elsewhere.
2. An iPhone with iOS 16.4 or newer.
3. The Relay's one-time enrolment token, to connect this computer to it.

**Pairing**

- Choose **Show a pairing code**, open the Relay address in Safari on the phone, then Share and Add to Home Screen. Open Codehouse from the Home Screen and type the code.
- Notifications only work for the Home Screen app.

**Security**

The Relay only ever carries encrypted data. Your phone signs every answer, and this computer checks the signature, that it is fresh and that it matches the request, before it counts. Revoke a phone here and its answers are refused at once.`,
  },
  settings: {
    id: "settings",
    title: "Settings",
    body: `Settings are saved on this computer, as you change them: a switch or a choice at once, a typed box when you leave it or press Enter. A short message confirms each save, or says what was wrong.

**Instructions for every session** (Sessions) are your own words that every new session is told at its start, ahead of its project's and its own. They apply to sessions started after you save.

**Quick prompt** (General) is a small window over whatever you are doing, opened by a shortcut (Ctrl+Alt+Space until you change it) or from the tray menu. Type and press Enter to start a chat, or choose the coding session you started last to message it; the main window then opens there. Esc puts it away and gives the focus back to the program you were in. If another program already uses the shortcut you type, the one before stays and three free ones are offered. It is part of the Codehouse window, so a browser has no shortcut.

**Other AI providers** (Sessions, a preview) lets a chat run on a model on this computer instead of Claude: Ollama, or a server that speaks the OpenAI chat API (llama.cpp, LM Studio). IT installs the runtime; Codehouse never downloads one. Give its address (it must be on this computer), list the models you allow (for Ollama, a model's sha256 digest pins the exact copy), and **Save and check** says whether it is ready. Ollama must be 0.17.1 or newer. The models then appear in Start a chat under **On this computer**. Such a chat is in Plan mode with read-only tools (read, find and search files, fetch a page), every tool call goes to the Approver as Claude's do, and what it sends the model has your redaction list applied. It has no web search, and it is not brought back after Codehouse restarts. **Your organisation's gateway** reaches a hosted model (Azure OpenAI and others) the same way: a gateway on this computer that IT runs holds the provider's credentials, Codehouse sends it no key or password, and the chat says where your words go and what that provider keeps.

**Voice typing** (General) shows a microphone beside the prompt box. It starts Windows voice typing there (the same as Win+H) and Windows types what you say, for you to read before you send it. It is off until you switch it on, because Windows may send your voice to Microsoft to be recognised: check your organisation allows that first. Codehouse itself never hears or keeps any audio.

**Temporary files** (General) says how much Codehouse and its checks have left in the Windows temp folder when a run was cut off, and **Clear temporary files** removes them. Codehouse also clears those an hour old or more when it starts and once a day, never one that may still be in use, and nothing that is not its own. Every coding session is also asked to delete the temporary files it makes and to stop the processes it starts when it is done with them.

**Sections and search.** The list on the left holds General, Account and plan, Sessions, Phone and notifications, Privacy and Updates; choose one to see its settings, and Codehouse opens on the one you used last. The search box finds a setting by its name or by the words in its explanation, across every section, and marks the one that matches. A group of settings that differs from how Codehouse starts says **Changed from the default**, and its section says **Changed** in the list.

- **Expected organisation**: sessions only start when your Claude account belongs to it. This stops a personal account being used by mistake.
- **Where new projects go**: the folder a new project gets its own folder in, for example C:\\dev. It counts as a workspace folder. Restart Codehouse after changing it.
- **Workspace roots**: the folders Claude may work in without extra checks.
- **Quiet hours**: hold phone notifications at night. Requests still wait on this computer.
- **Timeouts**: how long the phone can answer, and when an unanswered request is denied.
- **Daily digest**: a short summary sent to your phone each day.
- **Redaction list**: words replaced before anything is saved or sent, for example client names.
- **Checkpoints**: snapshots taken before risky steps so you can restore.
- **Updates**: the version you have, how often Codehouse looks for a new one, skipped versions, and going back to the version before.
- **Background picture**: which faint roadhouse picture sits behind the screens, or your own.

Some changes apply at once; others say a restart is needed.`,
  },
  "first-run": {
    id: "first-run",
    title: "Before you start",
    body: `Codehouse checks four things before a session can run: that you are signed in to Claude, that your account belongs to the expected organisation, whether managed settings are in force (information only), and that the Approver is running.

Use the sign-in buttons to sign in through Anthropic's own page in your browser. Codehouse never sees your password. Then set your organisation and choose **Check again**.`,
  },
  guide: {
    id: "guide",
    title: "User guide",
    body: "The full guide to Codehouse. Pick a topic on the left.",
  },
  setup: {
    id: "setup",
    title: "Setup",
    body: `The setup wizard runs the first time you open Codehouse. It signs you in, checks your organisation, offers phone alerts, and lets you choose a theme. You can skip it and run it again from Settings.`,
  },
}

export const GUIDE: Article[] = [
  {
    id: "what",
    title: "What Codehouse does",
    body: `Codehouse runs Claude sessions on your computer and keeps you in charge of what they do.

Claude asks permission before it runs a command, edits a file or uses a tool. Codehouse's Approver answers most of those requests for you using rules: safe reads and routine commands are allowed, dangerous ones are denied. Only the few it cannot be sure about wait for you, on this computer and on your phone at the same time.

Every decision, automatic or yours, is written to a tamper-evident audit log.`,
  },
  {
    id: "start",
    title: "Getting started",
    body: `1. **Sign in.** Codehouse uses your own Claude account. Use the sign-in buttons in the setup wizard; your browser opens Anthropic's page.
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
  {
    id: "accounts",
    title: "Several Claude accounts",
    body: `You can sign in more than one Claude account, such as your work one and a personal one, and switch between them from your name at the foot of the sidebar.

- **Choosing an account** shows its sessions in the sidebar, the workspace, the Dashboard and Sessions, and new sessions and chats start on it. Sessions on your other accounts keep running, and their requests still come to Approvals.
- **Accounts...** adds one: give it a name, then sign it in through Anthropic's own page. If your browser is already signed in to another Claude account, choose **Open in a private window**, or the page may sign this one in as that one.
- **Confirm the organisation** the account says it belongs to. Its sessions start only once you have, and only while it still says so.
- **Remove** takes an added account off the list; its sign-in stays in its own folder.

Earlier sessions are listed for the main account only, for now. Your laptop's managed policy applies to every account and may refuse one outside your organisation; check your company's rules before you add a personal one.`,
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
   git clone https://github.com/breakmylegs/gatehouse.git codehouse
2. Install or update the Relay, with the address your phone will use:
   cd codehouse and then ./deploy/relay/install.sh https://relay.your-domain
3. Add this site to the server's Caddyfile and reload Caddy (Caddy gets the certificate itself):
   relay.your-domain { reverse_proxy 127.0.0.1:8087 }
4. The install prints a one-time enrolment token. Keep it for the next step.

**In Codehouse**

1. Open Devices, then Or connect to a Relay you run elsewhere.
2. Give the address (https://relay.your-domain), the one-time token, and a name for this computer, then Connect.
3. Choose Add a phone and follow the steps on the iPhone.

**Updating** is the same install command again; paired phones are kept. The Relay only ever holds encrypted data, and every answer from the phone is checked here before it counts.`,
  },
  {
    id: "updates",
    title: "Updates",
    body: `You install Codehouse once, with Codehouse-Setup.exe. After that it keeps itself up to date.

**How it works**

1. Every 30 minutes (change it in Settings, Updates) Codehouse looks for a new version on GitHub.
2. When there is one, an **Update to** button appears at the foot of the sidebar. It lists what is new.
3. Choose **Update now**. Codehouse downloads only the parts that changed, checks them against its release signature, and builds the new version beside the one you are using. You can keep working while it does.
4. Codehouse then closes, switches to the new version and opens again by itself, usually within a minute. Open sessions come back by themselves, in the same panes, with what was said in them and the settings they had. A turn that was running stops: send a message to carry on.

With **Download a new version as soon as it is found** on (it is, unless you turn it off), step 3 has already happened by the time you see the button, so Update is quick. Nothing changes until you choose Update.

**Skipping and going back**

- **Skip this version** stops Codehouse offering it. A newer one is still offered. You can offer a skipped version again in Settings.
- You can skip any number of versions and update straight to the newest: each version is complete, not a patch on the one before.
- The version before is kept beside the current one. **Go back** in Settings switches to it. If a new version does not start, Codehouse goes back by itself and tells you.
- If Codehouse will not open at all after an update, run **Codehouse-Update.exe --rollback** from its folder (%LOCALAPPDATA%\\Programs\\Codehouse, or %LOCALAPPDATA%\\Programs\\Codehouse if it was installed before the rename on 31 Oct 2026).

**What stays yours**

Your settings, audit log and phone pairing live in your data folder and are never touched. Your rules (rules.yaml, rules.user.yaml, remembered decisions, project overlays) are carried to the new version; only the shipped rule library is replaced.

**Safety**

Each release is signed. Codehouse refuses anything not signed with its release key, any download whose size or fingerprint does not match, and any address that is not GitHub's.`,
  },
  {
    id: "trouble",
    title: "Troubleshooting",
    body: `- **A session will not start and mentions the organisation.** Open Settings and set the expected organisation to the one shown on the sign-in check, then Check again.
- **The folder does not exist.** Codehouse creates it for you. A relative path, a file or a missing drive is refused with a message saying which.
- **Nothing appears on the board.** Good: everything is being decided automatically. The audit log shows each decision.
- **Not connected to the Host.** Codehouse reconnects by itself. Requests keep waiting and nothing is decided while it is disconnected.
- **The kill switch is engaged.** Every request is denied until you choose Re-arm.`,
  },
]
