import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { gatehouseDataDir } from "./paths.js"

/** How often Codehouse looks for a new version, in minutes. 0 means never. */
/** A folder on a drive, below its root, outside Windows and Program Files. */
export const PROJECTS_FOLDER =
  /^[A-Za-z]:[\\/](?!(windows|program files)([\\/]|\s|\(|$))[^<>:"|?*\u0000-\u001f]+$/i

export const UPDATE_INTERVALS = [0, 15, 30, 60, 240, 1440] as const
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * The settings file is read by every version of Codehouse, older and newer, because an update can be undone. So the
 * schema is built twice from one definition: a loose copy that keeps settings it does not know (written by a newer
 * version) and a strict copy that names them, so the settings screen can still refuse a setting nobody has.
 */
function build(loose: boolean) {
  const obj = <T extends z.ZodRawShape>(shape: T) =>
    loose ? z.object(shape).loose() : z.object(shape).strict()
  /** What one provider does with your words, as you recorded it (B17). */
  const Boundary = obj({
    /** How long it keeps what is sent, in your words ("nothing", "30 days"). */
    keeps: z.string().max(80).optional(),
    training: z.enum(["no", "yes", "unknown"]).optional(),
    region: z.string().max(80).optional(),
    /** Zero data retention: an agreement that nothing is kept. */
    zdr: z.enum(["yes", "no", "unknown"]).optional(),
    /** When you checked, and where (a page or a person). */
    checkedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    source: z.string().max(200).optional(),
  })
  const Checkpoints = obj({
    /** Take a checkpoint before any call that is escalated to a person. */
    beforeEscalation: z.boolean().default(true),
    /** Take a checkpoint before the first edit after a quiet spell. */
    editBursts: z.boolean().default(true),
    burstWindowMs: z.number().int().min(1000).default(60_000),
  })
  return obj({
    /** Client names, internal host names and the like, redacted everywhere (invariant 12). */
    redactTerms: z.array(z.string()).default([]),
    /** The organisation the signed-in account must belong to (invariant 14). */
    expectedOrg: z.string().optional(),
    /**
     * Claude accounts added beside the main one (owner, 30 Oct). Each has a Claude Code folder of its own and the
     * organisation it must belong to, confirmed once it has signed in.
     */
    accounts: z
      .array(
        z.object({
          id: z.string().regex(/^[0-9a-f]{8}$/),
          label: z.string().max(60),
          configDir: z.string().min(1),
          expectedOrg: z.string().optional(),
        }),
      )
      .optional(),
    /** Replaces the workspace roots in the rules file. Absent means use the rules file. */
    workspaceRoots: z.array(z.string().min(1)).optional(),
    /**
     * Where a new project goes when you start a session without choosing a folder (owner, 30 Oct). Its folder is
     * named from your first prompt. It counts as a workspace root, or the rules would block every edit in it.
     */
    projectsFolder: z
      .string()
      .max(240)
      .regex(
        PROJECTS_FOLDER,
        "must be a full folder path, not a drive, a network path or a Windows folder",
      )
      .optional(),
    /** Replaces the quiet hours in the rules file. Absent means use the rules file. */
    quietHours: obj({
      start: z.string().regex(TIME),
      end: z.string().regex(TIME),
      tz: z.string().min(1),
      phone: z.boolean().optional(),
    }).optional(),
    /**
     * What every session is told at its start, in your own words (owner, 31 Oct). Up to 8000 characters. Absent: nothing.
     * Read by older versions too, which keep it without using it.
     */
    globalInstructions: z.string().max(8000).optional(),
    /** Keep the computer awake while a session works (owner, 4 Nov). Absent is on; false turns it off. */
    keepAwake: z.boolean().optional(),
    /** While you were away, written by Claude in plain English (owner, 4 Nov). Absent is on; false turns it off. */
    recapByClaude: z.boolean().optional(),
    /** Continue locally (CH-07): the turns kept word for word, and the characters of history before the rest is summed up. */
    chatContinue: z
      .object({
        turns: z.number().int().min(1).max(200).optional(),
        budgetChars: z.number().int().min(2000).max(400_000).optional(),
      })
      .passthrough()
      .optional(),
    /** Open in Claude (CH-06): where an imported chat opens in claude.ai. Absent: an Edge app window, Default profile. */
    chatHandoff: z
      .object({
        target: z.enum(["edge", "browser", "app"]).optional(),
        edgeProfile: z
          .string()
          .regex(/^(Default|Profile \d{1,3}|Guest Profile)$/)
          .optional(),
        appLink: z.boolean().optional(),
        templates: z
          .object({
            chat: z.string().max(300).optional(),
            project: z.string().max(300).optional(),
            new: z.string().max(300).optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
    /**
     * Who you are to Claude, from Settings, Account and plan, Profile (owner, 4 Nov, after Claude's desktop app): what
     * it should call you and what best describes your work. Told to every session first. Absent: nothing.
     */
    profile: z
      .object({ callMe: z.string().max(60).optional(), work: z.string().max(120).optional() })
      .optional(),
    /** When the daily digest is sent to the phone, local time. Null turns it off. Absent means 08:00. */
    digestTime: z.string().regex(TIME).nullable().optional(),
    /** Outbound-only push channels. Answers come back over a connection this computer opens. */
    push: obj({
      ntfy: obj({
        enabled: z.boolean(),
        server: z.string().url(),
        topic: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
        replyTopic: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
        maxRisk: z.number().int().min(0).max(84),
        /** A server that needs a sign-in: which kind, and the user name. The token or password is sealed apart. */
        auth: z.enum(["token", "basic"]).optional(),
        user: z.string().max(120).optional(),
      }).optional(),
      /** Slack, through Socket Mode. The tokens are kept encrypted elsewhere, never here. */
      slack: obj({
        enabled: z.boolean(),
        channel: z.string().regex(/^[A-Z0-9]{6,20}$/),
        userId: z.string().regex(/^[UW][A-Z0-9]{6,20}$/),
        maxRisk: z.number().int().min(0).max(84),
      }).optional(),
    }).optional(),
    /** The phone Relay run inside Codehouse, started again each time Codehouse starts while enabled. */
    localRelay: obj({
      enabled: z.boolean(),
      publicUrl: z.string().url(),
      port: z.number().int().min(1024).max(65535),
    }).optional(),
    /** Updates: how often to look for a new version, and the versions you chose to skip. */
    updates: obj({
      checkEveryMinutes: z
        .number()
        .int()
        .refine((n) => (UPDATE_INTERVALS as readonly number[]).includes(n), {
          message: `must be one of ${UPDATE_INTERVALS.join(", ")}`,
        })
        .default(30),
      skipped: z.array(z.string().max(40)).max(50).default([]),
      /** Download a new version as soon as it is found, so Update is quick. Nothing is installed until you say. */
      downloadInBackground: z.boolean().default(true),
    }).default({ checkEveryMinutes: 30, skipped: [], downloadInBackground: true }),
    /** Overrides the default rules file. */
    rulesPath: z.string().optional(),
    /**
     * Other AI providers (ADR 0008 and 0009): off when absent. Even on, only providers that pass the conformance
     * suite are listed, and none but Claude exists yet. Older versions keep it without using it.
     */
    providers: obj({
      multi: obj({ enabled: z.boolean() }).optional(),
      /** A model runtime on this computer (ADR 0011) and the models it may use. Only used while multi is on. */
      local: obj({
        kind: z.enum(["ollama", "openai-compatible", "gateway"]),
        /** For a gateway (ADR 0010): the provider it forwards to, and what that provider keeps. */
        forwardsTo: z.string().max(60).optional(),
        keeps: z.enum(["nothing", "30-days", "unknown"]).optional(),
        url: z.string().max(200),
        models: z
          .array(
            obj({
              name: z.string().regex(/^[\w.:/-]{1,100}$/),
              digest: z
                .string()
                .regex(/^(sha256:)?[a-fA-F0-9]{64}$/)
                .optional(),
            }),
          )
          .max(20),
      }).optional(),
      /**
       * Where your words go, for each provider (B17): what it keeps, whether it trains on them, where, whether it has
       * zero data retention, and when and where you checked. Codehouse cannot see these itself; you record them.
       */
      boundaries: obj({
        claude: Boundary.optional(),
        local: Boundary.optional(),
      }).optional(),
    }).optional(),
    /** How long a request stays deliverable to the phone. */
    phoneExpiryMs: z
      .number()
      .int()
      .min(10_000)
      .default(10 * 60_000),
    /** After this long without an answer a request is denied as timed out. */
    hardTimeoutMs: z
      .number()
      .int()
      .min(10_000)
      .default(30 * 60_000),
    checkpoints: Checkpoints.default({
      beforeEscalation: true,
      editBursts: true,
      burstWindowMs: 60_000,
    }),
    /**
     * Extreme approval carries on by itself after each turn until the build queue is empty (owner, 30 Oct), at most
     * this many automatic turns and dollars after one message of yours. Owner, 31 Oct: higher by default, and either
     * may be No limit (the flags; an older version reads the number, kept at its highest).
     */
    /**
     * When sessions pause for the plan's 5-hour limit (owner): the percentage, or off. Absent: 95%. Older versions keep
     * it without using it, and pause at 95%.
     */
    /**
     * The most effort a session may use (B18): low, medium, high, xhigh or max. Absent: no cap. Older versions keep it
     * without using it.
     */
    /**
     * B36: a local OpenTelemetry export of decisions: to a file in the data folder, to a collector on this computer
     * (127.0.0.1 or localhost only), or both. Absent: off. Spans never hold prompts, commands, paths or names.
     */
    telemetry: obj({
      file: z.boolean().optional(),
      endpoint: z
        .string()
        .max(200)
        .regex(
          /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}(\/[A-Za-z0-9._~\/-]*)?$/,
          "must be a collector on this computer",
        )
        .optional(),
    }).optional(),
    /** B20: the most spent a day, in dollars, over every session; at it, they pause until tomorrow. Absent: no cap. */
    spendCapUsd: z.number().min(1).max(10000).optional(),
    /**
     * Owner's Settings overhaul (6 Nov): the output style new coding sessions start with, by name (Claude Code's own
     * Explanatory or Learning, or one of yours). Absent: Claude Code's default. Older versions keep it unused.
     */
    outputStyle: z
      .string()
      .regex(/^[A-Za-z0-9][\w .-]{0,59}$/)
      .optional(),
    /**
     * Owner's Settings overhaul (6 Nov): where new worktrees go. Absent: beside the project. A folder must be inside a
     * workspace root (checked when a worktree is made). Older versions keep it unused and put them beside.
     */
    /**
     * Owner's Settings overhaul (6 Nov): pull requests from a session in a worktree. The branch prefix new worktree
     * branches get (absent: codehouse/), and whether such a session opens a pull request when done (as a draft unless
     * draft is false) and fixes failing checks. Pushing and gh still go through the rules (git-remote). Older versions
     * keep it unused.
     */
    pullRequests: z
      .object({
        branchPrefix: z
          .string()
          .regex(/^(?![-/.])(?!.*\.\.)(?!.*\/\/)(?!.*\.lock\/?$)[A-Za-z0-9._/-]{1,40}$/)
          .optional(),
        create: z.boolean().optional(),
        draft: z.boolean().optional(),
        fixChecks: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    /**
     * Owner's Settings overhaul (6 Nov): Browser tools. On, a coding session has look_at_page: a picture and the text
     * of a page on this computer (localhost only). Absent or false: off. Older versions keep it unused.
     */
    browserTools: z.boolean().optional(),
    worktreeLocation: z
      .object({
        where: z.enum(["beside", "inside", "folder"]),
        folder: z.string().max(240).optional(),
      })
      .passthrough()
      .optional(),
    /** B09: the most sessions and chats open at once, 1 to 32. Absent: no limit. Older versions keep it unused. */
    maxSessions: z.number().int().min(1).max(32).optional(),
    effortCap: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    /**
     * C-004: from this commit charge (a share of what RAM and the page file can hold) Codehouse starts no new session,
     * chat or page look. Absent: 85%. Older versions keep it unused.
     */
    /**
     * D-001: projects strict about their tests, by folder name, or all of them. Strict, Extreme approval waits for a
     * person on a change that weakens the tests; otherwise it approves it and the session says so. Absent: none.
     */
    testIntegrity: z
      .object({
        strictAll: z.boolean().optional(),
        strictProjects: z.array(z.string().max(120)).max(200).optional(),
      })
      .passthrough()
      .optional(),
    /** D-015: files whose words are not the project's own (globs); absent: README and Markdown files, dependencies. */
    untrustedFiles: z.array(z.string().max(260)).max(100).optional(),
    memoryGovernor: z
      .object({ percent: z.number().int().min(50).max(99), off: z.boolean().optional() })
      .passthrough()
      .optional(),
    planLimitPause: obj({
      percent: z.number().int().min(50).max(99),
      off: z.boolean().optional(),
      /** B26: true keeps a paused session paused after the reset, until you start it. */
      noAutoResume: z.boolean().optional(),
    }).optional(),
    extremeCarryOn: z
      .object({
        turns: z.number().int().min(1).max(500).default(200),
        usd: z.number().min(1).max(1000).default(500),
        noTurnLimit: z.boolean().optional(),
        noSpendLimit: z.boolean().optional(),
      })
      .default({ turns: 200, usd: 500 }),
  })
}

/** Settings the laptop-side processes read. The settings screen writes this file. Keeps settings it does not know. */
export const GatehouseConfig = build(true)
/** The same settings, refusing any it does not know. */
export const GatehouseConfigStrict = build(false)
export type GatehouseConfig = z.infer<typeof GatehouseConfigStrict>

/** Settings in a value that this version does not know, as dotted paths ("push.ntfy.newThing"). */
export function unknownConfigKeys(value: unknown): string[] {
  const r = GatehouseConfigStrict.safeParse(value)
  if (r.success) return []
  const out: string[] = []
  for (const issue of r.error.issues)
    if (issue.code === "unrecognized_keys")
      for (const k of issue.keys) out.push([...issue.path.map(String), k].join("."))
  return out
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.GATEHOUSE_CONFIG ?? path.join(gatehouseDataDir(env), "config.json")
}

/**
 * A missing file gives the defaults. A present but invalid file throws, it is never ignored. Settings this version
 * does not know (from a newer version, before an update was undone) are kept, not refused.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatehouseConfig {
  const file = configPath(env)
  if (!fs.existsSync(file)) return GatehouseConfig.parse({}) as GatehouseConfig
  return GatehouseConfig.parse(JSON.parse(fs.readFileSync(file, "utf8"))) as GatehouseConfig
}
