import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { gatehouseDataDir } from "./paths.js"
import { MAC_PROJECTS_FOLDER } from "./folders-mac.js" // Mac fork

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
    /** D-085: the most sensitive content this model or provider may be handed, when the card is in date. Absent: internal. */
    maxClassification: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
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
    /** E-080: the public keys (PEM, Ed25519) whose signed team redaction lists may be imported. */
    redactionListKeys: z.array(z.string().max(2000)).max(20).optional(),
    /** C-055: the Ed25519 public keys (PEM) you trust to sign shared rule packs. Read when the policy loads. */
    rulePackKeys: z.array(z.string().max(2000)).max(20).optional(),
    /**
     * E-086: writing rules for what Codehouse writes (corrected, listed in the preview) and what agents write (checked,
     * never rewritten). Absent: UK spelling and no dashes, the house style. Read tolerantly by the Host.
     */
    writingRules: z
      .object({
        ukSpelling: z.boolean().optional(),
        noDashes: z.boolean().optional(),
        terms: z.array(z.object({ use: z.string(), not: z.array(z.string()) }).passthrough()).optional(),
        banned: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
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
        process.platform === "darwin" ? MAC_PROJECTS_FOLDER : PROJECTS_FOLDER, // Mac fork
        process.platform === "darwin"
          ? "must be a full folder path such as /Users/you/dev, not / or a system folder"
          : "must be a full folder path, not a drive, a network path or a Windows folder",
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
     * E-094, the escalation ladder: minutes the phone and the push channels (ntfy, Slack) wait before they are told of
     * a request, 0 to 60. Absent: every channel at once. The desktop is always told at once, and deadlines are unchanged.
     */
    /**
     * T-016: models of your own in the model pickers, with the names you give them (a newer model before Codehouse
     * lists it, or one your gateway serves). At most 20. The id is passed to Claude Code as it is written.
     */
    customModels: z
      .array(z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:\-[\]/]{0,99}$/), label: z.string().min(1).max(40) }).passthrough())
      .max(20)
      .optional(),
    /**
     * T-128: prices of your own (dollars per million tokens) and one model counted as another, in the Usage report only.
     * At most 50.
     */
    modelPricing: z
      .array(
        z
          .object({
            model: z.string().min(1).max(100),
            inputPerM: z.number().min(0).max(10_000).optional(),
            outputPerM: z.number().min(0).max(10_000).optional(),
            cacheReadPerM: z.number().min(0).max(10_000).optional(),
            cacheWritePerM: z.number().min(0).max(10_000).optional(),
            countAs: z.string().min(1).max(100).optional(),
          })
          .passthrough(),
      )
      .max(50)
      .optional(),
    /** T-024: days after which a finished, unpinned session is archived by itself; 0 for never. Absent: 3. */
    settleAfterDays: z.number().int().min(0).max(365).optional(),
    /** T-020: a suggested next prompt after each turn, filled in with Tab. On unless false. */
    promptSuggestions: z.boolean().optional(),
    /** O42: Claude sums up each session every ten minutes for its timeline. On unless false. */
    timelineSummaries: z.boolean().optional(),
    /** E-089: on battery, Extreme sessions pause until mains power is back. Off unless true. */
    pauseExtremeOnBattery: z.boolean().optional(),
    /** T-134: credential fields may hold 1Password references, read with op when needed. Off unless true. */
    onePassword: z.boolean().optional(),
    escalationLadder: obj({
      phoneAfterMinutes: z.number().int().min(0).max(60).optional(),
      pushAfterMinutes: z.number().int().min(0).max(60).optional(),
      /** Mac fork (owner, 18 Nov): the waits only while someone is using the Mac; away, every channel is told at once. */
      onlyWhenHere: z.boolean().optional(),
    }).optional(),
    /**
     * What every session is told at its start, in your own words (owner, 31 Oct). Up to 8000 characters. Absent: nothing.
     * Read by older versions too, which keep it without using it.
     */
    globalInstructions: z.string().max(8000).optional(),
    /** Keep the computer awake while a session works (owner, 4 Nov). Absent is on; false turns it off. */
    keepAwake: z.boolean().optional(),
    /**
     * Mac fork (owner, 12 Nov): what the phone is told through the Relay. "decisions": only requests waiting for you
     * (permissions, plans, questions), as ntfy is; sessions finishing, notes from Claude, the digest and alerts are
     * not sent. Absent or "all": everything, as before.
     */
    phoneAlerts: z.enum(["all", "decisions"]).optional(),
    /** While you were away, written by Claude in plain English (owner, 4 Nov). Absent is on; false turns it off. */
    recapByClaude: z.boolean().optional(),
    /** E-038: how many days the log store keeps a project's lines, 1 to 90. Absent: 7. */
    logRetentionDays: z.number().int().min(1).max(90).optional(),
    /** E-066: days kept by data classification and kind; what is not set comes from the defaults. */
    retention: z
      .partialRecord(z.enum(["public", "internal", "confidential", "restricted"]), z.object({ evidence: z.number().int().min(1).max(3650).optional(), logs: z.number().int().min(1).max(365).optional() }).passthrough())
      .optional(),
    /**
     * E-090: the figures the energy estimate uses: this computer's draw at full load (watts), the models' energy
     * (watt-hours per thousand tokens; absent: not known) and the grid's carbon intensity (g CO2e per kWh; absent: not known).
     */
    energy: z
      .object({ deviceWatts: z.number().positive().max(2000).optional(), modelWhPer1kTokens: z.number().min(0).max(1000).optional(), gridGramsPerKwh: z.number().min(0).max(2000).optional() })
      .passthrough()
      .optional(),
    /**
     * G26: the outgoing-connection proxy a session's commands are pointed at, on 127.0.0.1; off unless switched on.
     * Only the hosts allowed go through, by the upstream proxy when one is named (no user name or password).
     */
    sandbox: z
      .object({
        egressProxy: z.boolean().optional(),
        allow: z.array(z.string().max(260)).max(500).optional(),
        upstream: z.string().max(300).optional(),
      })
      .passthrough()
      .optional(),
    /** E-040: the local OTLP trace receiver on 127.0.0.1, off unless switched on; its port (absent: 4318). */
    traceReceiver: z.object({ enabled: z.boolean().optional(), port: z.number().int().min(1024).max(65535).optional() }).passthrough().optional(),
    /** E-026: heavy checks in a Podman container (no network, project read-only). Off unless switched on. */
    containerRuns: z.object({ enabled: z.boolean().optional(), image: z.string().max(255).optional() }).passthrough().optional(),
    /** O36: the risk at or above which Rules-based Extreme approval waits for you, 1 to 101 (101: never). Absent: 80. */
    extremeRiskLimit: z.number().int().min(1).max(101).optional(),
    /** T-061: read-only forge connections through each forge's own command line. Off unless switched on. */
    forges: z.object({ github: z.boolean().optional() }).passthrough().optional(),
    /** T-089: worktrees removed by rules, all off unless set; never one with any uncommitted, untracked or ignored file. */
    worktreeCleanup: z
      .object({
        unchanged: z.boolean().optional(),
        merged: z.boolean().optional(),
        inactiveDays: z.number().int().min(1).max(365).optional(),
      })
      .passthrough()
      .optional(),
    /** T-018: sessions named by Claude after their first turn. Absent is on; false turns it off. */
    titleByClaude: z.boolean().optional(),
    /** T-019: how you like titles, told to the model that writes them. */
    titleInstructions: z.string().max(300).optional(),
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
    /**
     * D-087: minutes between summaries of the phone's non-urgent notices (a turn finished, the digest, a note from
     * Claude). Approvals and errors still go at once. Absent: each notice goes at once.
     */
    noticeBatchMinutes: z.number().int().min(5).max(240).optional(),
    /** D-089: the minutes of review an hour you can give; above it the approvals list warns. Absent: no warning. */
    reviewCapacityMinutes: z.number().int().min(5).max(600).optional(),
    /**
     * D-094: the egress report. Hosts a Claude session may also reach (a package registry), and strict, which stops a
     * session that reaches anything outside its list. Absent: no extra hosts, not strict.
     */
    egress: z
      .object({ strict: z.boolean().optional(), allowHosts: z.array(z.string().regex(/^[a-z0-9.-]{1,253}$/i)).max(50).optional() })
      .passthrough()
      .optional(),
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
        /** C-067: an OpenAI-compatible runtime that is Foundry Local (a new kind would stop older versions reading this file). */
        profile: z.enum(["foundry-local"]).optional(),
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
       * D-086: a model on the runtime above that also judges Claude's done-claims for reward hacks. Only a runtime on
       * this computer (never a gateway), only a model listed there; it can only lower a claim, never raise one.
       */
      claimJudge: obj({ model: z.string().regex(/^[\w.:/-]{1,100}$/) }).optional(),
      /** C-043: a model on the runtime or gateway above that reviews a session's change when you ask. It has no tools. */
      reviewer: obj({ model: z.string().regex(/^[\w.:/-]{1,100}$/) }).optional(),
      /**
       * Where your words go, for each provider (B17): what it keeps, whether it trains on them, where, whether it has
       * zero data retention, and when and where you checked. Codehouse cannot see these itself; you record them.
       */
      boundaries: obj({
        claude: Boundary.optional(),
        local: Boundary.optional(),
        /** C-016: a card for one model, by its id, which says more than its provider's card. */
        models: z.record(z.string().min(1).max(120), Boundary).optional(),
        /**
         * C-016: how old a card's check may be before a send to its model is refused (days). Absent: 180. A provider
         * or model with no card is not refused (older versions kept none).
         */
        maxAgeDays: z.number().int().min(1).max(3650).optional(),
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
     * T-071: your own keys for Codehouse's commands, by command id ("sidebar": "Ctrl+Alt+B"; empty for none). Read
     * tolerantly by the window: an id it does not know is kept and left alone. Older versions keep them unused.
     */
    shortcuts: z.record(z.string().min(1).max(40), z.string().max(40)).optional(),
    /**
     * T-091: your project actions, by project name: run by your click in the terminal pane, as if you typed them.
     * Older versions keep them unused.
     */
    projectActions: z
      .record(
        z.string().min(1).max(120),
        z
          .array(
            obj({
              name: z.string().min(1).max(60),
              command: z.string().min(1).max(2000).regex(/^[^\r\n]*$/),
              kind: z.enum(["setup", "run"]).optional(),
              preview: z.string().regex(/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/\S*)?$/i).optional(),
            }),
          )
          .max(30),
      )
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
    /**
     * D-018: a risk budget for each session, opt-in: points an allow given without a person spends (Moderate 1, High
     * 3); at zero Manual-family sessions drop to Manual and Extreme ones pause. Absent: no budget.
     */
    riskBudget: z
      .object({ points: z.number().int().min(1).max(1000), off: z.boolean().optional() })
      .passthrough()
      .optional(),
    /**
     * D-085: how sensitive each project's content is, by folder name, for a hand-off to another model. Absent: every
     * project is internal.
     */
    dataClassification: z
      .object({
        default: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
        projects: z.record(z.string().max(120), z.enum(["public", "internal", "confidential", "restricted"])).optional(),
      })
      .passthrough()
      .optional(),
    /** D-015: files whose words are not the project's own (globs); absent: README and Markdown files, dependencies. */
    untrustedFiles: z.array(z.string().max(260)).max(100).optional(),
    /**
     * D-055: SPDX licences a new dependency may have without asking, and "npm:name" entries accepted whatever their
     * licence. Absent: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD and Unlicense. A managed policy's list
     * is used instead when it sets one.
     */
    allowedLicences: z.array(z.string().max(120)).max(200).optional(),
    /** D-004: the mutation score each project must reach, by folder name; absent: none, the score is only shown. */
    mutation: z
      .object({ thresholds: z.record(z.string().max(120), z.number().int().min(0).max(100)).optional() })
      .passthrough()
      .optional(),
    /** D-003: how long change evidence packs are kept. Absent: 90 days. */
    evidence: z
      .object({ retentionDays: z.number().int().min(1).max(3650) })
      .passthrough()
      .optional(),
    memoryGovernor: z
      // `on` (16 Nov): the governor is off unless it is set.
      .object({ percent: z.number().int().min(50).max(99), off: z.boolean().optional(), on: z.boolean().optional() })
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
