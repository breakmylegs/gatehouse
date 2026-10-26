import { Ajv } from "ajv"
import type { Overlay, RememberFile, RulesFile } from "./types.js"

const stringList = { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 } as const

export const ruleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
    tools: stringList,
    exceptTools: stringList,
    commands: stringList,
    pathGlobs: stringList,
    pathInside: { const: "workspaceRoots" },
    pathOutside: { const: "workspaceRoots" },
    pathUnc: { type: "boolean" },
    mcpSource: stringList,
    everySegmentMustMatch: { const: true },
    risk: { type: "integer", minimum: 0, maximum: 100 },
    message: { type: "string" },
    powershell: {
      type: "object",
      additionalProperties: false,
      properties: {
        encodedCommand: { type: "boolean" },
        invokeExpression: { type: "boolean" },
        dynamicInvocation: { type: "boolean" },
      },
    },
    bash: {
      type: "object",
      additionalProperties: false,
      properties: {
        evalDynamic: { type: "boolean" },
        pipeToShell: { type: "boolean" },
      },
    },
  },
} as const

export const rulesFileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "workspaceRoots", "floor", "deny", "escalate", "allow"],
  properties: {
    version: { const: 1 },
    workspaceRoots: stringList,
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        unknownTool: { const: "escalate" },
        parseError: { const: "escalate" },
        judge: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            model: { type: "string" },
            maxInputChars: { type: "integer", minimum: 100 },
          },
        },
      },
    },
    quietHours: {
      type: "object",
      additionalProperties: false,
      required: ["start", "end", "tz"],
      properties: {
        start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        tz: { type: "string" },
        phone: { type: "boolean" },
      },
    },
    floor: { type: "array", items: ruleSchema },
    deny: { type: "array", items: ruleSchema },
    escalate: { type: "array", items: ruleSchema },
    allow: { type: "array", items: ruleSchema },
    judgeEligible: { type: "array", items: { type: "string" } },
  },
} as const

/** An overlay can only add deny or escalate rules, or remove allow rules. Nothing else is accepted. */
export const overlaySchema = {
  type: "object",
  additionalProperties: false,
  required: ["version"],
  properties: {
    version: { const: 1 },
    project: { type: "string" },
    deny: { type: "array", items: ruleSchema },
    escalate: { type: "array", items: ruleSchema },
    removeAllow: { type: "array", items: { type: "string" } },
  },
} as const

export const rememberFileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "remember"],
  properties: {
    version: { const: 1 },
    remember: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "tool"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
          tool: { type: "string", minLength: 1 },
          command: { type: "string", minLength: 1 },
          path: { type: "string", minLength: 1 },
          createdAt: { type: "string" },
        },
      },
    },
  },
} as const

const ajv = new Ajv({ allErrors: true, strict: true })
const validateRules = ajv.compile<RulesFile>(rulesFileSchema)
const validateOverlay = ajv.compile<Overlay>(overlaySchema)
const validateRemember = ajv.compile<RememberFile>(rememberFileSchema)

function describe(errors: typeof validateRules.errors): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`)
}

export function checkRulesFile(data: unknown): { ok: true; value: RulesFile } | { ok: false; errors: string[] } {
  return validateRules(data) ? { ok: true, value: data } : { ok: false, errors: describe(validateRules.errors) }
}

export function checkOverlay(data: unknown): { ok: true; value: Overlay } | { ok: false; errors: string[] } {
  if (typeof data === "object" && data !== null) {
    const widening = ["allow", "floor", "workspaceRoots", "defaults", "quietHours", "judgeEligible"].filter(
      (k) => k in data,
    )
    if (widening.length > 0) {
      return {
        ok: false,
        errors: widening.map((k) => `/${k} is not allowed in an overlay (overlays can only tighten)`),
      }
    }
  }
  return validateOverlay(data) ? { ok: true, value: data } : { ok: false, errors: describe(validateOverlay.errors) }
}

export function checkRememberFile(data: unknown): { ok: true; value: RememberFile } | { ok: false; errors: string[] } {
  return validateRemember(data) ? { ok: true, value: data } : { ok: false, errors: describe(validateRemember.errors) }
}
