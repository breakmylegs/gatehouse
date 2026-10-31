// Several Claude accounts signed in at once (owner, 30 Oct): each in a Claude Code folder of its own, never a
// credential read (invariant 6), and a session only on an account that still belongs to the organisation confirmed
// for it (invariant 14, per account).
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Accounts, MAIN_ACCOUNT, signInPage, type AccountEntry } from "../src/accounts.js"
import { AccountMonitor } from "../src/account.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
let saved: AccountEntry[] = []
let accounts: Accounts

const build = () =>
  new Accounts({
    saved: () => saved,
    save: async (list) => {
      saved = list
    },
    mainExpectedOrg: () => "ACN - Premium",
    dataDir: s.dir,
    queryFn: s.sdk.queryFn,
    probeOptions: (env) => ({ cwd: s.repo, permissionMode: "default", env }),
    managedDetected: async () => false,
    mainMonitor: s.account,
    onSignedIn: () => undefined,
  })

beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  accounts = build()
  s.deps.accounts = accounts
}, 60000)
afterAll(() => s.stop())

describe("the accounts JCVC knows", () => {
  it("lists the main account first, and gives each added one a Claude Code folder of its own", async () => {
    const added = await accounts.add("  Personal  ")
    expect(accounts.all().map((a) => a.id)).toEqual([MAIN_ACCOUNT, added.id])
    expect(added).toMatchObject({ label: "Personal" })
    expect(added.configDir).toBe(path.join(s.dir, "accounts", added.id, "claude"))
    expect(fs.existsSync(added.configDir as string)).toBe(true)
    expect(accounts.get(MAIN_ACCOUNT)?.expectedOrg).toBe("ACN - Premium")
  })

  it("runs an added account's Claude Code with its own folder and no credentials in the environment", async () => {
    const added = await accounts.add("Personal")
    const before = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "sk-should-never-pass"
    try {
      const env = accounts.env(added.id)
      expect(env.CLAUDE_CONFIG_DIR).toBe(added.configDir)
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(accounts.env(MAIN_ACCOUNT).CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR)
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = before
    }
  })

  it("takes the organisation an account reports as the one it must belong to, only once it has signed in", async () => {
    const added = await accounts.add("Personal")
    await expect(accounts.confirmOrg(added.id)).rejects.toThrow(/Sign it in first/)
    await accounts.monitor(added.id).refresh()
    expect((await accounts.confirmOrg(added.id)).expectedOrg).toBe("ACN - Premium")
    await expect(accounts.confirmOrg(MAIN_ACCOUNT)).rejects.toThrow(/Settings/)
    await expect(accounts.remove(MAIN_ACCOUNT)).rejects.toThrow(/cannot be removed/)
    await accounts.remove(added.id)
    expect(accounts.get(added.id)).toBeUndefined()
  })

  it("opens only Anthropic's own sign-in pages in a private window", () => {
    expect(signInPage("https://claude.ai/oauth/authorize?code=true")).toBe(
      "https://claude.ai/oauth/authorize?code=true",
    )
    for (const bad of [
      "http://claude.ai/oauth",
      "https://claude.ai.evil.example/oauth",
      "https://example.com/?next=https://claude.ai",
      "javascript:alert(1)",
      "not a url",
    ])
      expect(() => signInPage(bad)).toThrow()
  })
})

describe("a session on an added account", () => {
  it("starts with the account's folder once its organisation is confirmed, and says which account", async () => {
    const added = await accounts.add("Personal")
    // Not confirmed yet: it does not start.
    await expect(s.manager.start({ cwd: s.repo, account: added.id })).rejects.toThrow()
    await accounts.monitor(added.id).refresh()
    await accounts.confirmOrg(added.id)
    const session = await s.manager.start({ cwd: s.repo, account: added.id })
    expect(session.info().account).toBe(added.id)
    expect(s.sdk.queries.at(-1)?.options.env?.CLAUDE_CONFIG_DIR).toBe(added.configDir)
    // The main account's sessions are as they were.
    const main = await s.manager.start({ cwd: s.repo })
    expect(main.info().account).toBeUndefined()
    expect(s.sdk.queries.at(-1)?.options.env?.CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR)
  })

  it("refuses an account JCVC does not know, and one that now reports a different organisation", async () => {
    await expect(s.manager.start({ cwd: s.repo, account: "0badf00d" })).rejects.toThrow(
      /not signed in/,
    )
    const added = await accounts.add("Personal")
    await accounts.monitor(added.id).refresh()
    await accounts.confirmOrg(added.id)
    saved = saved.map((a) => (a.id === added.id ? { ...a, expectedOrg: "Someone Else Ltd" } : a))
    await expect(s.manager.start({ cwd: s.repo, account: added.id })).rejects.toThrow()
    expect(s.manager.list().some((x) => x.account === added.id && x.state !== "error")).toBe(false)
  })

  it("keeps each account's check apart from the main one's", async () => {
    const added = await accounts.add("Personal")
    expect(accounts.monitor(added.id)).toBeInstanceOf(AccountMonitor)
    expect(accounts.monitor(added.id)).not.toBe(accounts.monitor(MAIN_ACCOUNT))
    expect(accounts.monitor(MAIN_ACCOUNT)).toBe(s.account)
  })
})
