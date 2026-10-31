import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { sanitiseEnv } from "@gatehouse/shared"
import { AccountMonitor, type QueryFn } from "./account.js"
import { findClaudeBinary, SignInFlow } from "./signin.js"

/**
 * Several Claude accounts signed in at once (owner, 30 Oct). The main account is Claude Code's usual sign-in on this
 * computer. Each added one has a Claude Code folder of its own (CLAUDE_CONFIG_DIR), so its sign-in, sessions and
 * settings stay apart; JCVC never reads what is in it (invariant 6). Each has its own expected organisation, which
 * you confirm once it has signed in, and a session starts only if its account still matches it (invariant 14, per
 * account by the owner's decision).
 */
export const MAIN_ACCOUNT = "main"

export interface AccountEntry {
  id: string
  label: string
  /** Claude Code's folder for this account. Absent for the main account, which uses Claude Code's usual one. */
  configDir?: string
  /** The organisation this account must belong to. The main account's is the one in Settings. */
  expectedOrg?: string
}

export interface AccountsDeps {
  /** The added accounts, from the settings file. */
  saved: () => AccountEntry[]
  save: (list: AccountEntry[]) => Promise<void>
  mainExpectedOrg: () => string | undefined
  dataDir: string
  queryFn: QueryFn
  /** A probe that can run nothing, with this environment. */
  probeOptions: (env: Record<string, string | undefined>) => Options
  managedDetected: () => Promise<boolean | undefined>
  /** The main account's check, which the rest of JCVC already uses. */
  mainMonitor: AccountMonitor
  /** The main account's sign-in, which the rest of JCVC already uses. */
  mainSignIn?: SignInFlow
  onSignedIn: (id: string) => void | Promise<void>
  /** Opens a sign-in page in a private Edge window. Injected for tests. */
  openPrivate?: (url: string) => void
}

const ID = /^[0-9a-f]{8}$/
/** Only Anthropic's own sign-in pages are opened in a private window. */
const SIGN_IN_HOSTS = new Set([
  "claude.ai",
  "claude.com",
  "console.anthropic.com",
  "platform.claude.com",
])

export class Accounts {
  readonly #d: AccountsDeps
  readonly #monitors = new Map<string, AccountMonitor>()
  readonly #signIns = new Map<string, SignInFlow>()

  constructor(d: AccountsDeps) {
    this.#d = d
    this.#monitors.set(MAIN_ACCOUNT, d.mainMonitor)
    if (d.mainSignIn) this.#signIns.set(MAIN_ACCOUNT, d.mainSignIn)
  }

  all(): AccountEntry[] {
    const expected = this.#d.mainExpectedOrg()
    return [
      { id: MAIN_ACCOUNT, label: "Main account", ...(expected ? { expectedOrg: expected } : {}) },
      ...this.#d.saved().filter((a) => ID.test(a.id) && a.configDir),
    ]
  }

  get(id: string = MAIN_ACCOUNT): AccountEntry | undefined {
    return this.all().find((a) => a.id === id)
  }

  /** The environment Claude Code runs with for this account: no credentials in it, and its own folder. */
  env(id: string = MAIN_ACCOUNT): Record<string, string | undefined> {
    const env = sanitiseEnv(process.env)
    const a = this.get(id)
    if (a?.configDir) env.CLAUDE_CONFIG_DIR = a.configDir
    return env
  }

  monitor(id: string = MAIN_ACCOUNT): AccountMonitor {
    let m = this.#monitors.get(id)
    if (!m) {
      m = new AccountMonitor({
        queryFn: this.#d.queryFn,
        expectedOrg: () => this.get(id)?.expectedOrg,
        probeOptions: () => this.#d.probeOptions(this.env(id)),
        managedDetected: this.#d.managedDetected,
      })
      this.#monitors.set(id, m)
    }
    return m
  }

  /** Anthropic's own sign-in for this account, in the unmodified Claude Code binary, with its folder. */
  signIn(id: string = MAIN_ACCOUNT): SignInFlow {
    let f = this.#signIns.get(id)
    if (!f) {
      f = new SignInFlow({
        binary: findClaudeBinary,
        env: () => this.env(id),
        onEnded: async () => {
          await this.monitor(id).refresh()
          await this.#d.onSignedIn(id)
        },
      })
      this.#signIns.set(id, f)
    }
    return f
  }

  /**
   * Opens this account's sign-in page in a private Edge window, so the browser's own sign-in to claude.ai cannot
   * hand back a different account (owner, 30 Oct). Only Anthropic's own pages, and only one Claude Code printed.
   */
  openPrivate(id: string): void {
    const url = this.signIn(id).status().url
    if (!url) throw new Error("There is no sign-in page yet. Start signing in first.")
    ;(this.#d.openPrivate ?? openInPrivateEdge)(signInPage(url))
  }

  async add(label: string): Promise<AccountEntry> {
    const id = randomBytes(4).toString("hex")
    const configDir = path.join(this.#d.dataDir, "accounts", id, "claude")
    fs.mkdirSync(configDir, { recursive: true })
    const entry: AccountEntry = {
      id,
      label: label.trim().slice(0, 60) || "Another account",
      configDir,
    }
    await this.#d.save([...this.#d.saved(), entry])
    return entry
  }

  /** The organisation the account reports now becomes the one it must belong to. Not for the main account. */
  async confirmOrg(id: string): Promise<AccountEntry> {
    if (id === MAIN_ACCOUNT) throw new Error("The main account's organisation is set in Settings.")
    const org = this.monitor(id).last()?.organization
    if (!org)
      throw new Error(
        "This account has not said which organisation it belongs to. Sign it in first.",
      )
    const list = this.#d.saved().map((a) => (a.id === id ? { ...a, expectedOrg: org } : a))
    if (!list.some((a) => a.id === id)) throw new Error("There is no such account.")
    await this.#d.save(list)
    return this.get(id) as AccountEntry
  }

  /** Leaves the list; its folder stays, so nothing of Claude Code's is deleted. Not for the main account. */
  async remove(id: string): Promise<void> {
    if (id === MAIN_ACCOUNT) throw new Error("The main account cannot be removed.")
    await this.#d.save(this.#d.saved().filter((a) => a.id !== id))
    this.#monitors.delete(id)
    this.#signIns.get(id)?.cancel()
    this.#signIns.delete(id)
  }
}

/** The address, if it is one of Anthropic's own sign-in pages over https; anything else is refused. */
export function signInPage(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error("That is not a sign-in page JCVC opens.")
  }
  if (u.protocol !== "https:" || !SIGN_IN_HOSTS.has(u.hostname))
    throw new Error("That is not one of Anthropic's sign-in pages, so JCVC does not open it.")
  return u.href
}

function openInPrivateEdge(url: string): void {
  const edge = ["ProgramFiles(x86)", "ProgramFiles"]
    .map((v) => path.join(process.env[v] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"))
    .find((p) => fs.existsSync(p))
  if (!edge)
    throw new Error("Microsoft Edge was not found, so open the page in a private window yourself.")
  // No shell: the address is one argument, checked above.
  spawn(edge, ["--inprivate", url], { detached: true, stdio: "ignore", windowsHide: false }).unref()
}
