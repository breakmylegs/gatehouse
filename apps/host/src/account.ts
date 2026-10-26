import type { AccountInfo, Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { sanitiseEnv } from "@gatehouse/shared"

export type OrgCheck =
  | { ok: true }
  | {
      ok: false
      code: "no-expected-org" | "not-signed-in" | "wrong-org" | "wrong-provider"
      message: string
    }

/**
 * Invariant 14: a session may only start when the signed-in account belongs to the organisation the owner
 * named in Gatehouse settings. Every case that is not a clear yes is a no. Note that this never reads a
 * credential: the account comes from the SDK's own initialisation reply.
 */
export function checkOrg(account: AccountInfo | undefined, expectedOrg: string | undefined): OrgCheck {
  if (!expectedOrg || expectedOrg.trim() === "") {
    return {
      ok: false,
      code: "no-expected-org",
      message: "No expected organisation is set. Open settings and enter the organisation shown by /status in Claude Code.",
    }
  }
  if (!account || (!account.email && !account.organization)) {
    return {
      ok: false,
      code: "not-signed-in",
      message: "You are not signed in. Run /login in the Claude Code terminal and choose your organisation's single sign-on.",
    }
  }
  if (account.apiProvider !== undefined && account.apiProvider !== "firstParty") {
    return {
      ok: false,
      code: "wrong-provider",
      message: `Claude Code is using ${account.apiProvider}, not the Anthropic sign-in, so the organisation cannot be checked.`,
    }
  }
  if (!account.organization || account.organization.trim().toLowerCase() !== expectedOrg.trim().toLowerCase()) {
    return {
      ok: false,
      code: "wrong-org",
      message: `You are signed in to "${account.organization ?? "no organisation"}" but Gatehouse is set up for "${expectedOrg}". Sign in again with the right account.`,
    }
  }
  return { ok: true }
}

export type QueryFn = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query

export interface AccountSnapshot {
  signedIn: boolean
  email?: string
  organization?: string
  subscriptionType?: string
  apiProvider?: string
  /** What the SDK can tell us about managed policy. See docs/sdk-notes.md for what is and is not visible. */
  managedPolicy: "detected" | "not-detected" | "unknown"
  org: OrgCheck
  checkedAt: string
}

export interface AccountMonitorDeps {
  queryFn: QueryFn
  expectedOrg: () => string | undefined
  /** Builds the safe options for a probe session (deny-all, floor hook). */
  probeOptions: () => Options
  /** True if the SDK reports a managed settings source. Injected so tests need no real settings. */
  managedDetected: () => Promise<boolean | undefined>
  now?: () => Date
}

/**
 * Finds out who is signed in, for the UI header and the first-run screen. It starts one short-lived SDK
 * process and reads its initialisation reply, then closes it without sending a prompt.
 */
export class AccountMonitor {
  readonly #deps: AccountMonitorDeps
  #last: AccountSnapshot | undefined

  constructor(deps: AccountMonitorDeps) {
    this.#deps = deps
  }

  last(): AccountSnapshot | undefined {
    return this.#last
  }

  /** From a session's own initialisation, so a running session keeps the header current for free. */
  note(account: AccountInfo | undefined, managed: boolean | undefined): AccountSnapshot {
    const snap = this.#snapshot(account, managed)
    this.#last = snap
    return snap
  }

  async refresh(): Promise<AccountSnapshot> {
    let account: AccountInfo | undefined
    try {
      const q = this.#deps.queryFn({ prompt: neverYields(), options: this.#deps.probeOptions() })
      try {
        account = (await q.initializationResult()).account
      } finally {
        q.close()
      }
    } catch {
      account = undefined
    }
    let managed: boolean | undefined
    try {
      managed = await this.#deps.managedDetected()
    } catch {
      managed = undefined
    }
    return this.note(account, managed)
  }

  #snapshot(account: AccountInfo | undefined, managed: boolean | undefined): AccountSnapshot {
    return {
      signedIn: Boolean(account && (account.email || account.organization)),
      ...(account?.email ? { email: account.email } : {}),
      ...(account?.organization ? { organization: account.organization } : {}),
      ...(account?.subscriptionType ? { subscriptionType: account.subscriptionType } : {}),
      ...(account?.apiProvider ? { apiProvider: account.apiProvider } : {}),
      managedPolicy: managed === undefined ? "unknown" : managed ? "detected" : "not-detected",
      org: checkOrg(account, this.#deps.expectedOrg()),
      checkedAt: (this.#deps.now ?? (() => new Date()))().toISOString(),
    }
  }
}

/** A prompt stream that never produces a message, so a session starts and idles. */
export async function* neverYields(): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(() => undefined)
}

/** Options for a probe: nothing it does can run, and the environment carries no credentials. */
export function probeEnv(): Record<string, string | undefined> {
  return sanitiseEnv(process.env)
}
