import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { gatehouseDataDir } from "./paths.js"

const Checkpoints = z
  .object({
    /** Take a checkpoint before any call that is escalated to a person. */
    beforeEscalation: z.boolean().default(true),
    /** Take a checkpoint before the first edit after a quiet spell. */
    editBursts: z.boolean().default(true),
    burstWindowMs: z.number().int().min(1000).default(60_000),
  })
  .strict()

/** Settings the laptop-side processes read. The settings screen writes this file. */
export const GatehouseConfig = z
  .object({
    /** Client names, internal host names and the like, redacted everywhere (invariant 12). */
    redactTerms: z.array(z.string()).default([]),
    /** The organisation the signed-in account must belong to (invariant 14). */
    expectedOrg: z.string().optional(),
    /** Replaces the workspace roots in the rules file. Absent means use the rules file. */
    workspaceRoots: z.array(z.string().min(1)).optional(),
    /** Replaces the quiet hours in the rules file. Absent means use the rules file. */
    quietHours: z
      .object({
        start: z.string().regex(/^([01]d|2[0-3]):[0-5]d$/),
        end: z.string().regex(/^([01]d|2[0-3]):[0-5]d$/),
        tz: z.string().min(1),
        phone: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** When the daily digest is sent to the phone, local time. Null turns it off. Absent means 08:00. */
    digestTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    /** Outbound-only push channels. Answers come back over a connection this computer opens. */
    push: z
      .object({
        ntfy: z
          .object({
            enabled: z.boolean(),
            server: z.string().url(),
            topic: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
            replyTopic: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
            maxRisk: z.number().int().min(0).max(84),
          })
          .strict()
          .optional(),
        /** Slack, through Socket Mode. The tokens are kept encrypted elsewhere, never here. */
        slack: z
          .object({
            enabled: z.boolean(),
            channel: z.string().regex(/^[A-Z0-9]{6,20}$/),
            userId: z.string().regex(/^[UW][A-Z0-9]{6,20}$/),
            maxRisk: z.number().int().min(0).max(84),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** The phone Relay run inside JCVC, started again each time JCVC starts while enabled. */
    localRelay: z
      .object({
        enabled: z.boolean(),
        publicUrl: z.string().url(),
        port: z.number().int().min(1024).max(65535),
      })
      .strict()
      .optional(),
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
  .strict()
export type GatehouseConfig = z.infer<typeof GatehouseConfig>

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.GATEHOUSE_CONFIG ?? path.join(gatehouseDataDir(env), "config.json")
}

/** A missing file gives the defaults. A present but invalid file throws, it is never ignored. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatehouseConfig {
  const file = configPath(env)
  if (!fs.existsSync(file)) return GatehouseConfig.parse({})
  return GatehouseConfig.parse(JSON.parse(fs.readFileSync(file, "utf8")))
}
