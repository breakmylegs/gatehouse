/**
 * The Policy page's plain choices: what Claude may do, in words, over the same rules the Advanced studio edits.
 * Each choice owns some packs, some switched-off rules and some rules of yours; its options say which of those are
 * on. Reading a choice back finds the option that matches exactly, or "custom" when the rules were changed some
 * other way (in Advanced), and a custom choice is never rewritten here.
 *
 * Nothing here can loosen the floor or the deny rules: options only switch packs on and off, switch off allow or
 * escalate rules, and add rules of yours that deny.
 */

export interface PlainRule {
  id: string
  commands?: string[]
  message?: string
  [k: string]: unknown
}

export interface UserRulesShape {
  version: 1
  packs?: string[]
  disabled?: string[]
  allow?: PlainRule[]
  escalate?: PlainRule[]
  deny?: PlainRule[]
}

export type ChoiceId = "edit" | "git" | "build" | "run" | "install" | "web" | "push" | "caution"

export interface ChoiceOption {
  id: string
  /** On the switch: "Allowed", "Asks you", "Any file". */
  label: string
  /** The sentence the toast says once it is saved: "Claude now ...". */
  saved: string
  packs?: string[]
  disabled?: string[]
  deny?: PlainRule[]
}

export interface Choice {
  id: ChoiceId
  group: "Files" | "Commands" | "Internet" | "Extra caution"
  label: string
  help: string
  options: ChoiceOption[]
}

const NO_PUSH: PlainRule = {
  id: "my-jcvc-no-push",
  commands: ["git push*"],
  message: "You chose to block sending code to other servers. Ask the user to push it themselves.",
}

export const CHOICES: Choice[] = [
  {
    id: "edit",
    group: "Files",
    label: "Create and change files in your project folders",
    help: "Secrets files and anything outside your project folders stay blocked whatever you choose.",
    options: [
      {
        id: "any",
        label: "Any file",
        saved: "Claude now creates and changes any file in your project folders without asking.",
        packs: ["edit-workspace"],
      },
      {
        id: "code",
        label: "Code, tests and docs",
        saved:
          "Claude now changes code, tests, docs and markdown without asking, and asks about other files.",
      },
      {
        id: "ask",
        label: "Asks you",
        saved: "Claude now asks before it creates or changes any file.",
        disabled: ["edit-workspace-source"],
      },
    ],
  },
  {
    id: "git",
    group: "Commands",
    label: "Use git on this computer",
    help: "Looking at history and changes, saving work (commit) and switching branches. Nothing leaves the computer.",
    options: [
      {
        id: "allow",
        label: "Allowed",
        saved: "Claude now uses git on this computer without asking.",
        packs: ["git-read", "git-local"],
      },
      { id: "ask", label: "Asks you", saved: "Claude now asks before most git commands." },
    ],
  },
  {
    id: "build",
    group: "Commands",
    label: "Build, test and check your project",
    help: "Your project's own build, test and lint commands for Node, Python, .NET, Rust and Go. These run your project's own scripts.",
    options: [
      {
        id: "allow",
        label: "Allowed",
        saved: "Claude now builds, tests and checks your project without asking.",
        packs: ["node-dev", "python-dev", "dotnet-dev", "build-tools"],
      },
      { id: "ask", label: "Asks you", saved: "Claude now asks before building or testing." },
    ],
  },
  {
    id: "run",
    group: "Commands",
    label: "Run your app to try it",
    help: "Starting your app's development server or preview, such as npm run dev, so Claude can check its work.",
    options: [
      {
        id: "allow",
        label: "Allowed",
        saved: "Claude now starts your app to try it without asking.",
        packs: ["run-app"],
      },
      { id: "ask", label: "Asks you", saved: "Claude now asks before starting your app." },
    ],
  },
  {
    id: "install",
    group: "Commands",
    label: "Install packages for your project",
    help: "npm install, pip install and the like. Installing runs code from the internet. Installing for the whole computer always asks.",
    options: [
      {
        id: "allow",
        label: "Allowed",
        saved: "Claude now installs packages for your project without asking.",
        packs: ["packages"],
      },
      { id: "ask", label: "Asks you", saved: "Claude now asks before installing packages." },
    ],
  },
  {
    id: "web",
    group: "Internet",
    label: "Search the web and read pages",
    help: "For documentation and examples. Downloads, such as curl, still ask you.",
    options: [
      {
        id: "allow",
        label: "Allowed",
        saved: "Claude now searches the web and reads pages without asking.",
        packs: ["web-read"],
      },
      { id: "ask", label: "Asks you", saved: "Claude now asks before it uses the web." },
    ],
  },
  {
    id: "push",
    group: "Internet",
    label: "Send your code to GitHub or another server",
    help: "git push. It is never allowed without asking, because others can see it and it is hard to take back.",
    options: [
      {
        id: "ask",
        label: "Asks you",
        saved: "Claude now asks before it sends your code anywhere.",
      },
      {
        id: "block",
        label: "Blocked",
        saved: "Claude can no longer send your code anywhere.",
        deny: [NO_PUSH],
      },
    ],
  },
  {
    id: "caution",
    group: "Extra caution",
    label: "Ask before changing Windows or deleting whole folders",
    help: "The registry, services, scheduled tasks, network settings and recursive deletes. It only adds questions.",
    options: [
      {
        id: "on",
        label: "On",
        saved: "Claude now asks before changing Windows or deleting whole folders.",
        packs: ["windows-safety"],
      },
      { id: "off", label: "Off", saved: "The extra Windows caution is off." },
    ],
  },
]

export type Level = "careful" | "balanced" | "handsoff"
type Picks = Record<ChoiceId, string>

/** The levels set every choice except Extra caution, which stays as you set it. */
export const LEVELS: Array<{
  id: Level
  label: string
  summary: string
  picks: Omit<Picks, "caution">
}> = [
  {
    id: "careful",
    label: "Careful",
    summary:
      "Claude reads your project and changes code, tests and docs. Almost everything else asks you first.",
    picks: {
      edit: "code",
      git: "ask",
      build: "ask",
      run: "ask",
      install: "ask",
      web: "ask",
      push: "ask",
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    summary:
      "For building an app: Claude changes any file in your folders, uses git, builds, tests, runs your app and reads the web. Installing and sending code away ask you.",
    picks: {
      edit: "any",
      git: "allow",
      build: "allow",
      run: "allow",
      install: "ask",
      web: "allow",
      push: "ask",
    },
  },
  {
    id: "handsoff",
    label: "Hands-off",
    summary:
      "Balanced, and Claude installs packages for your project too. Sending code away, risky commands and anything unusual still ask you.",
    picks: {
      edit: "any",
      git: "allow",
      build: "allow",
      run: "allow",
      install: "allow",
      web: "allow",
      push: "ask",
    },
  },
]

const managed = (c: Choice) => ({
  packs: new Set(c.options.flatMap((o) => o.packs ?? [])),
  disabled: new Set(c.options.flatMap((o) => o.disabled ?? [])),
  deny: new Set(c.options.flatMap((o) => (o.deny ?? []).map((r) => r.id))),
})

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n")

/** Which option each choice is on, or "custom". */
export function readChoices(user: UserRulesShape): Record<ChoiceId, string> {
  const packs = user.packs ?? []
  const disabled = user.disabled ?? []
  const deny = (user.deny ?? []).map((r) => r.id)
  const out = {} as Record<ChoiceId, string>
  for (const c of CHOICES) {
    const m = managed(c)
    const on = {
      packs: packs.filter((p) => m.packs.has(p)),
      disabled: disabled.filter((d) => m.disabled.has(d)),
      deny: deny.filter((d) => m.deny.has(d)),
    }
    const hit = c.options.find(
      (o) =>
        sameSet(on.packs, o.packs ?? []) &&
        sameSet(on.disabled, o.disabled ?? []) &&
        sameSet(
          on.deny,
          (o.deny ?? []).map((r) => r.id),
        ),
    )
    out[c.id] = hit?.id ?? "custom"
  }
  return out
}

/** The level all the choices add up to, or "custom". */
export function readLevel(picks: Record<ChoiceId, string>): Level | "custom" {
  const hit = LEVELS.find((l) =>
    (Object.keys(l.picks) as Array<keyof typeof l.picks>).every((k) => picks[k] === l.picks[k]),
  )
  return hit?.id ?? "custom"
}

/**
 * Your rules with some choices set. Packs, switched-off rules and rules of yours that no choice manages are kept
 * as they were, and so is everything a "custom" choice manages.
 */
export function applyChoices(
  user: UserRulesShape,
  set: Partial<Record<ChoiceId, string>>,
): UserRulesShape {
  let packs = [...(user.packs ?? [])]
  let disabled = [...(user.disabled ?? [])]
  let deny = [...(user.deny ?? [])]
  for (const c of CHOICES) {
    const want = set[c.id]
    if (want === undefined || want === "custom") continue
    const option = c.options.find((o) => o.id === want)
    if (!option) throw new Error(`${c.id} has no option ${want}`)
    const m = managed(c)
    packs = packs.filter((p) => !m.packs.has(p)).concat(option.packs ?? [])
    disabled = disabled.filter((d) => !m.disabled.has(d)).concat(option.disabled ?? [])
    deny = deny.filter((r) => !m.deny.has(r.id)).concat(option.deny ?? [])
  }
  const out: UserRulesShape = { ...user, version: 1 }
  if (packs.length) out.packs = [...new Set(packs)].sort()
  else delete out.packs
  if (disabled.length) out.disabled = [...new Set(disabled)].sort()
  else delete out.disabled
  if (deny.length) out.deny = deny
  else delete out.deny
  return out
}

/** The choices a level sets. */
export const levelPicks = (level: Level): Partial<Record<ChoiceId, string>> =>
  LEVELS.find((l) => l.id === level)?.picks ?? {}
