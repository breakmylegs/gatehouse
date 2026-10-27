// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state: {
  standalone: boolean
  device: unknown
  items: unknown[]
  answers: unknown[]
  kills: number
  answerError?: string
} = { standalone: true, device: null, items: [], answers: [], kills: 0 }

vi.mock("../src/core", () => ({
  isStandalone: () => state.standalone,
  isIos: () => true,
  unlock: vi.fn(async () => ({ token: "t", expiresAt: Date.now() + 600_000 })),
  loadPending: vi.fn(async () => state.items),
  answer: vi.fn(async (_s: unknown, _d: unknown, item: { relayId: string }, what: unknown) => {
    if (state.answerError) throw new Error(state.answerError)
    state.answers.push({ id: item.relayId, what })
  }),
  kill: vi.fn(async () => void state.kills++),
  enableNotifications: vi.fn(async () => undefined),
  register: vi.fn(async () => ({
    pairingId: "p",
    fingerprint: "481516",
    code: "ABCD2345",
    keys: {},
    info: {},
  })),
  awaitConfirmation: vi.fn(() => new Promise(() => undefined)),
}))
vi.mock("../src/storage", () => ({
  storage: {
    device: async () => state.device ?? undefined,
    keys: async () => ({ privateKey: {}, publicKey: "k" }),
    settings: async () => ({ lockScreenDetail: false }),
    setSettings: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
  },
}))

import { App } from "../src/App"

const device = {
  phoneId: "ph1",
  hostPublicKey: "h",
  rpId: "x",
  origin: "https://x",
  credentialId: "c",
  name: "Peter's iPhone",
}
const opened = (over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  relayId: "r1",
  expiresAt: "2026-10-27T13:00:00Z",
  opened: {
    payloadHash: "h",
    payload: {
      id: "r1",
      nonce: "n",
      kind: "permission",
      toolName: "Bash",
      input: { command: "git push --force origin main && npm publish" },
      cwd: "C:\\proj",
      project: "atlas",
      verdict: {
        outcome: "escalate",
        ruleId: "force-push",
        reason: "Overwrites shared history",
        risk: 82,
        segments: [{ text: "git push --force origin main", ruleId: "x", outcome: "escalate" }],
      },
      createdAt: "",
      expiresAt: "",
      ...payload,
    },
    ...over,
  },
})

beforeEach(() => {
  Object.assign(state, {
    standalone: true,
    device,
    items: [],
    answers: [],
    kills: 0,
    answerError: undefined,
  })
  history.replaceState(null, "", "/")
  if (!("BroadcastChannel" in globalThis))
    (globalThis as Record<string, unknown>).BroadcastChannel = class {
      onmessage: unknown
      postMessage() {}
      close() {}
    }
})
afterEach(cleanup)

async function unlocked() {
  render(<App />)
  await userEvent.click(await screen.findByRole("button", { name: "Unlock with Face ID" }))
}

describe("getting started", () => {
  it("guides an iPhone through Add to Home Screen before anything else, and lets a tester skip", async () => {
    state.standalone = false
    state.device = null
    render(<App />)
    expect(
      await screen.findByText(/Add to Home Screen/, { selector: "strong" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/only allows notifications for apps on the Home Screen/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /Continue in the browser anyway/ }))
    expect(await screen.findByRole("heading", { name: "Pair this phone" })).toBeInTheDocument()
  })

  it("asks for the eight character code, only enabling Pair when it is complete, then shows the six digits", async () => {
    state.device = null
    render(<App />)
    const code = await screen.findByLabelText("Pairing code")
    const pair = screen.getByRole("button", { name: "Pair" })
    expect(pair).toBeDisabled()
    await userEvent.type(code, "abcd2345")
    expect(code).toHaveValue("ABCD2345")
    expect(pair).toBeEnabled()
    await userEvent.click(pair)
    expect(await screen.findByText("481516")).toBeInTheDocument()
    expect(screen.getByText(/do not confirm/i)).toBeInTheDocument()
  })

  it("starts locked and shows nothing until Face ID succeeds", async () => {
    state.items = [opened()]
    render(<App />)
    expect(await screen.findByText(/Locked/)).toBeInTheDocument()
    expect(screen.queryByText("atlas")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Unlock with Face ID" }))
    expect(await screen.findByText("atlas")).toBeInTheDocument()
  })
})

describe("the list and a request", () => {
  it("shows an empty state, and a waiting request with its risk as a word and a number", async () => {
    await unlocked()
    expect(await screen.findByText("All clear")).toBeInTheDocument()
    cleanup()
    state.items = [opened()]
    await unlocked()
    expect(await screen.findByText(/High risk 82/)).toBeInTheDocument()
    expect(screen.getByText("Run shell command")).toBeInTheDocument()
  })

  it("denies in one tap with Face ID, and says it was sent", async () => {
    state.items = [opened()]
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: /Run shell command/ }))
    expect(screen.getByLabelText("What will run").textContent).toBe(
      "git push --force origin main && npm publish",
    )
    expect(document.querySelector("mark")?.textContent).toBe("git push --force origin main")
    await userEvent.click(screen.getByRole("button", { name: "Deny" }))
    await waitFor(() => expect(state.answers).toEqual([{ id: "r1", what: { decision: "deny" } }]))
    expect(await screen.findByText(/Sent\. Waiting for your computer/)).toBeInTheDocument()
  })

  it("makes allowing a second, deliberate step, and Cancel is the focused choice", async () => {
    state.items = [opened()]
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: /Run shell command/ }))
    await userEvent.click(screen.getByRole("button", { name: "Allow once…" }))
    expect(state.answers).toEqual([])
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    await userEvent.click(screen.getByRole("button", { name: "Allow with Face ID" }))
    await waitFor(() => expect(state.answers).toEqual([{ id: "r1", what: { decision: "allow" } }]))
  })

  it("sends the message to Claude with the decision", async () => {
    state.items = [opened()]
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: /Run shell command/ }))
    await userEvent.click(screen.getByRole("button", { name: "Add a message" }))
    await userEvent.type(screen.getByLabelText("Message to Claude"), "use a branch")
    await userEvent.click(screen.getByRole("button", { name: "Deny" }))
    await waitFor(() =>
      expect(state.answers).toEqual([
        { id: "r1", what: { decision: "deny", message: "use a branch" } },
      ]),
    )
  })

  it("lets a request too big for the phone be denied but not allowed, and says why", async () => {
    state.items = [opened({ oversize: { characters: 20000 } }, { input: { shown: "nothing" } })]
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: /Run shell command/ }))
    expect(screen.getByText(/Too long to show on the phone/)).toBeInTheDocument()
    expect(screen.getByText(/20,000 characters/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Allow once…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled()
  })

  it("answers a question with the chosen option", async () => {
    state.items = [
      opened(
        {},
        {
          kind: "question",
          toolName: "AskUserQuestion",
          input: {
            questions: [
              {
                question: "Which database?",
                options: [{ label: "Postgres" }, { label: "SQLite" }],
              },
            ],
          },
          verdict: { outcome: "escalate", ruleId: "ask", reason: "Claude is asking", risk: 0 },
        },
      ),
    ]
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: /Question from Claude/ }))
    const send = screen.getByRole("button", { name: "Send answer with Face ID" })
    expect(send).toBeDisabled()
    await userEvent.click(screen.getByLabelText("SQLite"))
    await userEvent.click(send)
    await waitFor(() =>
      expect(state.answers).toEqual([
        { id: "r1", what: { answers: { "Which database?": "SQLite" } } },
      ]),
    )
  })

  it("tells the person plainly when Face ID is cancelled, and does not claim it was sent", async () => {
    state.answerError = "Face ID was cancelled or did not match. Nothing was sent."
    state.items = [opened()]
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: /Run shell command/ }))
    await userEvent.click(screen.getByRole("button", { name: "Deny" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was sent/)
    expect(screen.queryByText(/Sent\./)).toBeNull()
  })

  it("shows what was decided elsewhere, and that a request that has gone is gone", async () => {
    state.items = [{ ...opened(), resolved: { at: "x", summary: "Approved on desktop at 14:02" } }]
    await unlocked()
    expect(await screen.findByText(/Approved on desktop at 14:02/)).toBeInTheDocument()
    history.replaceState(null, "", "/#/r/zzz")
    cleanup()
    await unlocked()
    expect(await screen.findByText(/no longer waiting/)).toBeInTheDocument()
  })

  it("opens a request straight from a notification link", async () => {
    state.items = [opened()]
    history.replaceState(null, "", "/#/r/r1")
    await unlocked()
    expect(await screen.findByLabelText("What will run")).toBeInTheDocument()
  })

  it("shows a request that cannot be opened as unanswerable", async () => {
    state.items = [
      {
        relayId: "bad",
        expiresAt: "x",
        error:
          "This request could not be opened or did not match its checksum, so it cannot be answered here.",
      },
    ]
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: /Request/ }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot be answered here/)
  })
})

describe("settings", () => {
  async function inSettings() {
    await unlocked()
    await userEvent.click(await screen.findByRole("button", { name: "Settings" }))
  }

  it("keeps lock screen detail off by default and explains what turning it on does", async () => {
    await inSettings()
    const box = screen.getByRole("checkbox", { name: /Show details on the lock screen/ })
    expect(box).not.toBeChecked()
    expect(screen.getByText(/anyone who sees your screen/)).toBeInTheDocument()
  })

  it("sends the kill switch only after a second step", async () => {
    await inSettings()
    await userEvent.click(screen.getByRole("button", { name: "Kill switch…" }))
    expect(state.kills).toBe(0)
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    await userEvent.click(screen.getByRole("button", { name: /Stop everything with Face ID/ }))
    await waitFor(() => expect(state.kills).toBe(1))
    expect(await screen.findByText(/Check your computer/)).toBeInTheDocument()
  })

  it("says that only the computer can revoke this phone", async () => {
    await inSettings()
    expect(screen.getByText(/revoke it in Gatehouse on your computer/)).toBeInTheDocument()
  })
})
