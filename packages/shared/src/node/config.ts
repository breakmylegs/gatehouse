import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { gatehouseDataDir } from "./paths.js"

/** How often JCVC looks for a new version, in minutes. 0 means never. */
/** A folder on a drive, below its root, outside Windows and Program Files. */
export const PROJECTS_FOLDER =
  /^[A-Za-z]:[\\/](?!(windows|program files)([\\/]|\s|\(|$))[^<>:"|?*\u0000-\u001f]+$/i

export const UPDATE_INTERVALS = [0, 15, 30, 60, 240, 1440] as const
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * The settings file is read by every version of JCVC, older and newer, because an update can be undone. So the
 * schema is built twice from one definition: a loose copy that keeps settings it does not know (written by a newer
 * version) and a strict copy that names them, so the settings screen can still refuse a setting nobody has.
 */
function build(loose: boolean) {
  const obj = <T extends z.ZodRawShape>(shape: T) =>
    loose ? z.object(shape).loose() : z.object(shape).strict()
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
      }).optional(),
      /** Slack, through Socket Mode. The tokens are kept encrypted elsewhere, never here. */
      slack: obj({
        enabled: z.boolean(),
        channel: z.string().regex(/^[A-Z0-9]{6,20}$/),
        userId: z.string().regex(/^[UW][A-Z0-9]{6,20}$/),
        maxRisk: z.number().int().min(0).max(84),
      }).optional(),
    }).optional(),
    /** The phone Relay run inside JCVC, started again each time JCVC starts while enabled. */
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
