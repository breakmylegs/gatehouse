# Navigation review (O48, 25 Nov 2026)

The owner, 25 Nov: "It seems like a lot of main sections but then no way to navigate easily between the sections in the
menus. I'd like the main menu items to open that menu. And then there are secondary groupings with pill buttons along
the top." Evaluated with Design with Intent (https://designwithintent.ai/): its `/organize` skill ("Structure
information so people can find what they need, understand where they are, and navigate confidently") for the
structure, and its `/evaluate` shape for the findings (each issue with what happens, why it matters, what it breaks and
the change, by severity). Intent is written for phones first; the parts about a tab bar are read here as the sidebar of
a desktop window.

## What is there now

- **22 pages** (`Route` in `apps/web/src/store.ts`): Dashboard, Home, All sessions, the workspace, Board, Approvals,
  New question (chat), Projects, Memory, Prompts, Imported chat, Marketplace, MCP servers, Usage, Doctor, What Claude
  may do (policy), Approver, Audit log, Phone and notifications (devices), Settings, User guide, first run and setup.
- **Five ways in, each listing a different subset:**
  1. The sidebar: Needs you; a Chats or Code switch that changes the list below it (Ask about code shows New question,
     Projects, Memory, Prompts; Code shows Dashboard, New session, Ask about code, Search); two pinned pages by default
     (Approvals, What Claude may do); and More, a drop-down of every other page.
  2. The account menu at the top right: Settings, What Claude may do, Approver, Audit log, Phone and notifications, the
     theme, Help, User guide, Search.
  3. Search and commands (Ctrl K), which lists every page.
  4. Edit sidebar, to pin pages.
  5. Inside Settings, 14 sections in three groups, down the side of the page.
- **Inside a session:** ten buttons on its bar (Plan, Files, Search, Changes, Git, Terminal, Artifacts, Timeline,
  Browser, Details) and a menu of 62 more actions.

## Verdict

Significant issues. The pages are good; finding them is the problem. There is no stable map: which pages show depends on
the Chats or Code switch, on what you pinned, and on which menu you open, and once on a page nothing says which part of
Codehouse you are in or what sits beside it.

## Priority issues

### Major

1. **Most pages are hidden behind More.**
   - What happens: of 16 pages that can sit in the sidebar, two show by default; the rest are a drop-down list called
     More. The owner could not find MCP servers (built 16 Nov) or the Neighbourhood Watch settings.
   - Why it matters: what cannot be seen is not used.
   - Breaks: recognition rather than recall; visibility of what can be done.
   - Change: the sidebar lists every main section, always, each with its icon and name. Nothing is in a More list.

2. **No sense of where you are, nor of the pages beside this one.**
   - What happens: opening Audit log shows the audit log and nothing else; Approver and What Claude may do, its
     neighbours, are in another menu.
   - Why it matters: moving sideways means going back to a menu every time.
   - Breaks: visibility of system status; Intent's "understand where they are"; recognition rather than recall.
   - Change: each main section opens its own pages, shown as pill buttons along the top of the page, the current one
     marked. One click moves between pages of the same section.

3. **The same page is reached from different menus in different ways.**
   - What happens: Settings, the policy, the Approver and the audit log are in the account menu; Usage, Doctor and the
     Marketplace are in More; MCP servers only in More or by search; Phone and notifications in both the account menu and
     Settings.
   - Why it matters: people learn one way in and miss the rest.
   - Breaks: consistency and standards (Intent's "Inconsistent Patterns").
   - Change: one home for each page, in one section; the account menu keeps only the account (who is signed in, accounts,
     sign out) and the theme.

4. **The Chats or Code switch hides whole pages.**
   - What happens: Projects, Memory and Prompts show only while the switch is on Ask about code; Dashboard only on Code.
   - Why it matters: a page disappears when you change something that looks like a filter of the session list.
   - Breaks: user control; Intent's "Assumption of Context".
   - Change: the switch only chooses which sessions the list shows; the sections never change.

### Minor

5. **Settings is one long list of 14 sections, with Sessions holding 27 groups.**
   - Change: Settings becomes a section like the others, beside Phone and notifications, Doctor and the User guide, as
     pills along the top. Its own 14 sections stay down the side of the Settings page, with its search, so nothing in
     them moves. Splitting Sessions' 27 groups is left for a later pass.

6. **Two pages called home** (Home and Dashboard).
   - Change: one, Dashboard, in the Work section; Home stays reachable for what links to it.

7. **Nothing tells you a new page exists.**
   - Change: the sidebar lists every section, so a new page appears as a pill in its section, where it belongs.

### Cosmetic

8. **"What Claude may do" and "Approver" are separate places for one subject** (how calls are decided).
   - Change: both in one section, Safety, beside the audit log.

## What to keep

- Needs you at the top of the sidebar, with its count, which is the most important thing Codehouse shows.
- The session list in the sidebar, and the Chats or Code switch for it.
- Search and commands (Ctrl K), which reaches every page and every command.
- A session's own bar and menu: a session is its own place, and its tools stay with it.

## The new structure

Five main sections, each a sidebar item that opens its section. A section's pages are pills along the top of every
page in it; the section opens on the page you last used there.

| Section | Pills, in order |
| --- | --- |
| Work | Dashboard, All sessions, Board, Usage |
| Ask about code | New question, Projects, Memory, Prompts |
| Build | MCP servers, Marketplace |
| Safety | What Claude may do, Approver, Audit log |
| Settings | Settings, Phone and notifications, Doctor, User guide |

Below the sections, as now: the Chats or Code switch and the session list. Needs you stays at the top. The account menu
keeps the account and the theme. Pages reached another way (a session, first run, setup, an imported chat, Home) show no
pills, as now.

## Acceptance

- Every page has one section and is reachable in two clicks or fewer from anywhere, without search.
- The current section is marked in the sidebar and the current page in its pills (`aria-current="page"`).
- The pills are a navigation landmark named for their section, one tab stop, moved between with the arrow keys, Home
  and End.
- A saved sidebar choice from an older version is read without error (updates never break).
- Tests that fail when a page loses its section, when a section opens the wrong page, or when the pills stop marking
  the current page.
