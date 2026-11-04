/**
 * The Doctor (B07): what Codehouse needs to work safely on this computer, checked in one place, each with what to do
 * about it. The checks read facts the Host already has (the health it reports, the update status), plus Claude Code's
 * version, the listener's address and the free disk space. What it shows names no email address, token or path to a
 * file of yours, so the report can be copied into a message for help; the copy is redacted again before it leaves.
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import type { FastifyInstance } from "fastify"
import { sanitiseEnv, type Health } from "@gatehouse/shared"
import { gatehouseDataDir, managedPolicyDir, type GatehouseConfig } from "@gatehouse/shared/node"
import { readItModels } from "./providers/it-models.js"
import { redactString } from "@gatehouse/policy"
import { checkRuntime, type LocalRuntimeConfig } from "./providers/local-runtime.js"
import { inClaudeRange, rangeText } from "./claude-range.js"

export type DoctorState = "ok" | "warn" | "fail"

export interface DoctorCheck {
  id: string
  label: string
  state: DoctorState
  /** What was found, in words. */
  detail: string
  /** What to do about it, when it is not ok. */
  fix?: string
}

export interface DoctorFacts {
  health: Health
  /** Claude Code as Codehouse starts it: whether it was found, and the version it reports. */
  claude: { found: boolean; version?: string }
  /** The address the Host listens on. */
  listener: { address?: string }
  /** Free bytes on the drive that holds Codehouse's data folder, when it could be read. */
  diskFree?: number
  updates?: { kind: "release" | "source"; checkError?: string }
  /** A model runtime on this computer, when one is switched on. */
  localRuntime?: { ok: boolean; reason?: string }
}

const GB = 1024 ** 3

/** Every check, in the order a person would fix them: what stops sessions first. */
export function doctorChecks(f: DoctorFacts): DoctorCheck[] {
  const h = f.health
  const out: DoctorCheck[] = []
  const add = (c: DoctorCheck) => out.push(c)

  add(
    !f.claude.found
      ? {
          id: "claude-code",
          label: "Claude Code",
          state: "fail",
          detail: "Claude Code was not found, so no session can start.",
          fix: "Install Codehouse again with Codehouse-Setup.exe from the newest release: it brings Claude Code with it.",
        }
      : f.claude.version && !inClaudeRange(f.claude.version)
        ? {
            id: "claude-code",
            label: "Claude Code",
            state: "fail",
            detail: `Claude Code ${f.claude.version} is here, and this Codehouse was checked with ${rangeText()}, so sessions do not start.`,
            fix: "Settings, Updates: update Codehouse, or install it again with Codehouse-Setup.exe from the newest release.",
          }
        : f.claude.version
          ? {
              id: "claude-code",
              label: "Claude Code",
              state: "ok",
              detail: `Claude Code ${f.claude.version}, the version this Codehouse was checked with.`,
            }
          : {
              id: "claude-code",
              label: "Claude Code",
              state: "warn",
              detail: "Claude Code is here but did not say which version it is.",
              fix: "Restart Codehouse. If this stays, install it again with Codehouse-Setup.exe.",
            },
  )

  const s = h.signin
  add(
    s.checked === false
      ? {
          id: "sign-in",
          label: "Sign-in",
          state: "warn",
          detail: "Still checking your sign-in (it takes about 20 seconds after Codehouse starts).",
          fix: "Run the checks again in a moment.",
        }
      : !s.signedIn
        ? {
            id: "sign-in",
            label: "Sign-in",
            state: "fail",
            detail: "Claude Code is not signed in, so no session can start.",
            fix: "Settings, Accounts: Sign in. Sign-in happens in Claude Code's own window, never in Codehouse.",
          }
        : {
            id: "sign-in",
            label: "Sign-in",
            state: "ok",
            detail: s.organization ? `Signed in, with ${s.organization}.` : "Signed in.",
          },
  )
  if (s.checked !== false && s.signedIn)
    add(
      s.orgOk
        ? {
            id: "organisation",
            label: "Organisation",
            state: "ok",
            detail: "The account belongs to the organisation Codehouse expects.",
          }
        : {
            id: "organisation",
            label: "Organisation",
            state: "fail",
            detail:
              s.orgMessage ??
              "The account does not belong to the organisation Codehouse expects, so sessions do not start.",
            fix: "Sign in with your organisation's account, or set the expected organisation in Settings, Accounts.",
          },
    )

  const a = h.approver
  add(
    a.state !== "up"
      ? {
          id: "approver",
          label: "Approver",
          state: "fail",
          detail: `The Approver is ${a.state}, so every request waits for you.`,
          fix: "Approver: Restart. If it does not stay up, restart Codehouse.",
        }
      : a.errors.length
        ? {
            id: "approver",
            label: "Approver",
            state: "warn",
            detail: `The Approver runs, but ${a.errors.length === 1 ? "a rule file has a problem" : `${a.errors.length} rule files have problems`}, so the last rules that loaded are used.`,
            fix: "What Claude may do: open the rules and fix what it points out.",
          }
        : {
            id: "approver",
            label: "Approver",
            state: "ok",
            detail: "The Approver runs, with every rule file loaded.",
          },
  )

  add(
    h.killSwitch.engaged
      ? {
          id: "kill-switch",
          label: "Kill switch",
          state: "warn",
          detail: "The kill switch is on: every request is denied and no session starts.",
          fix: "Re-arm it from the top bar when you are ready.",
        }
      : { id: "kill-switch", label: "Kill switch", state: "ok", detail: "Off." },
  )

  add(
    f.listener.address === "127.0.0.1"
      ? {
          id: "listener",
          label: "Local connection",
          state: "ok",
          detail:
            "Codehouse listens on this computer only (127.0.0.1), with a token for every request.",
        }
      : {
          id: "listener",
          label: "Local connection",
          state: "fail",
          detail: `Codehouse is listening on ${f.listener.address ?? "an unknown address"}, not on this computer only.`,
          fix: "Quit Codehouse and start it again from its shortcut. Tell whoever set this computer up.",
        },
  )

  add(
    h.pwsh.running
      ? {
          id: "powershell",
          label: "PowerShell checker",
          state: "ok",
          detail: "Runs, so PowerShell commands are read before they run.",
        }
      : {
          id: "powershell",
          label: "PowerShell checker",
          state: "warn",
          detail: "Not running, so every PowerShell command comes to you.",
          fix: "Install PowerShell 7 (pwsh), then restart Codehouse.",
        },
  )

  add(
    h.relay.state === "unreachable"
      ? {
          id: "phone",
          label: "Phone",
          state: "warn",
          detail: "The phone Relay cannot be reached, so requests do not reach your phone.",
          fix: "Phone and notifications: check the Relay's address, or start the Relay on this computer.",
        }
      : h.relay.state === "connected"
        ? {
            id: "phone",
            label: "Phone",
            state: "ok",
            detail: `Connected, with ${h.relay.devices === 1 ? "1 phone" : `${h.relay.devices} phones`} paired.`,
          }
        : { id: "phone", label: "Phone", state: "ok", detail: "Not set up. It is optional." },
  )
  for (const p of h.push ?? [])
    add({
      id: `push-${p.channel}`,
      label: p.channel === "ntfy" ? "ntfy notifications" : "Slack notifications",
      state: p.ok ? "ok" : "warn",
      detail: p.ok
        ? "Working."
        : "Switched on, but not working now, so requests are not sent there.",
      ...(p.ok
        ? {}
        : { fix: "Phone and notifications: Test the channel and follow what it says." }),
    })

  if (f.localRuntime)
    add(
      f.localRuntime.ok
        ? {
            id: "local-models",
            label: "Models on this computer",
            state: "ok",
            detail: "The runtime answers, with the models you allowed.",
          }
        : {
            id: "local-models",
            label: "Models on this computer",
            state: "warn",
            detail: f.localRuntime.reason ?? "The runtime is switched on but not ready.",
            fix: "Settings, Models on this computer: start the runtime, then Save and check.",
          },
    )

  if (f.diskFree !== undefined)
    add(
      f.diskFree < 1 * GB
        ? {
            id: "disk",
            label: "Disk space",
            state: "fail",
            detail: `${(f.diskFree / GB).toFixed(1)} GB free on the drive Codehouse keeps its data on.`,
            fix: "Free some space: updates, checkpoints and the audit log need room, and an update stops without it.",
          }
        : f.diskFree < 5 * GB
          ? {
              id: "disk",
              label: "Disk space",
              state: "warn",
              detail: `${(f.diskFree / GB).toFixed(1)} GB free on the drive Codehouse keeps its data on.`,
              fix: "Free some space soon: an update needs about 1 GB.",
            }
          : {
              id: "disk",
              label: "Disk space",
              state: "ok",
              detail: `${Math.floor(f.diskFree / GB)} GB free.`,
            },
    )

  if (f.updates)
    add(
      f.updates.kind === "source"
        ? {
            id: "updates",
            label: "Updates",
            state: "ok",
            detail: "Runs from its source folder, so it is updated with git, not by itself.",
          }
        : f.updates.checkError
          ? {
              id: "updates",
              label: "Updates",
              state: "warn",
              detail: `The last check for a new version did not work: ${f.updates.checkError}`,
              fix: "Check that this computer can reach github.com, then Settings, Updates: Check now.",
            }
          : {
              id: "updates",
              label: "Updates",
              state: "ok",
              detail: "Checks for new versions by itself.",
            },
    )
  return out
}

/** The checks as plain text, for copying into a message. The caller redacts it. */
export function doctorReport(checks: DoctorCheck[], o: { version: string; at: string }): string {
  const mark = { ok: "OK  ", warn: "WARN", fail: "FAIL" } as const
  return [
    `Codehouse ${o.version}, checked ${o.at}`,
    "",
    ...checks.flatMap((c) => [
      `${mark[c.state]} ${c.label}: ${c.detail}`,
      ...(c.fix ? [`     What to do: ${c.fix}`] : []),
    ]),
    "",
  ].join("\n")
}

/** Claude Code's version, as `claude --version` reports it, with no credential in its environment. */
export async function claudeVersion(
  binary: () => string | undefined,
): Promise<DoctorFacts["claude"]> {
  const bin = binary()
  if (!bin) return { found: false }
  return await new Promise((resolve) => {
    execFile(
      bin,
      ["--version"],
      { timeout: 20_000, windowsHide: true, env: sanitiseEnv(process.env) },
      (_e, stdout) => {
        const v = /(\d+\.\d+\.\d+)/.exec(String(stdout ?? ""))?.[1]
        resolve(v ? { found: true, version: v } : { found: true })
      },
    )
  })
}

/** GET /api/doctor: every check, now, and the report to copy, redacted. */
export function registerDoctorRoutes(
  app: FastifyInstance,
  ctx: {
    health?: () => Health
    claude?: () => Promise<DoctorFacts["claude"]>
    updates?: { status: () => { current: string; kind: "release" | "source"; checkError?: string } }
    config: () => GatehouseConfig
    env: NodeJS.ProcessEnv
  },
): void {
  // Claude Code is asked its version at most every ten minutes: starting it takes a moment.
  let claude: { at: number; value: DoctorFacts["claude"] } | undefined
  app.get("/api/doctor", async (req, reply) => {
    if (!ctx.health) return reply.code(404).send({ error: "The checks are not available here." })
    if (!claude || Date.now() - claude.at > 600_000)
      claude = { at: Date.now(), value: (await ctx.claude?.()) ?? { found: false } }
    const where = req.server.server.address()
    const status = ctx.updates?.status()
    const local = ctx.config().providers
    const diskFree = await fs.promises
      .statfs(gatehouseDataDir(ctx.env))
      .then((s) => s.bavail * s.bsize)
      .catch(() => undefined)
    const facts: DoctorFacts = {
      health: ctx.health(),
      claude: claude.value,
      listener: { ...(where && typeof where === "object" ? { address: where.address } : {}) },
      ...(diskFree !== undefined ? { diskFree } : {}),
      ...(status
        ? {
            updates: {
              kind: status.kind,
              ...(status.checkError ? { checkError: status.checkError } : {}),
            },
          }
        : {}),
      ...(local?.multi?.enabled && local.local
        ? {
            localRuntime: await checkRuntime(
              local.local as LocalRuntimeConfig,
              fetch,
              readItModels(managedPolicyDir(ctx.env)),
            ).then(
              (c) => (c.ok ? { ok: true } : { ok: false, reason: c.reason }),
              () => ({ ok: false, reason: "The runtime could not be checked." }),
            ),
          }
        : {}),
    }
    const checks = doctorChecks(facts)
    const at = new Date().toISOString()
    const version = status?.current ?? "unknown"
    return { version, at, checks, report: forSharing(doctorReport(checks, { version, at })) }
  })
}

/** A report to send to someone: secrets redacted as everywhere, and email addresses taken out too. */
export const forSharing = (text: string): string =>
  redactString(text).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email address]")
