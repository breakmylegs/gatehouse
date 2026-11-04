// @vitest-environment jsdom
// Models on this computer (ADR 0011): offered in Start a chat only when the Host says the runtime passed its checks,
// started as a local chat with no research; the settings panel saves the runtime and models and says what it found.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProvidersPanel } from "../src/components/ProvidersPanel"
import { useStore } from "../src/store"
import { NewChat } from "../src/surfaces/NewChat"

const sent: Array<Record<string, unknown>> = []
const puts: unknown[] = []
let ready = true
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      if (cmd.type === "warm_chat") return { ok: true }
      sent.push(cmd)
      return cmd.type === "create_session" ? { ok: true, data: { sessionId: "c1" } } : { ok: true }
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    if (url !== "/api/providers") return { ok: false, status: 404, error: "no route" }
    if (method === "PUT") {
      puts.push(body)
      return {
        ok: true,
        status: 200,
        data: {
          ...(body as object),
          check: { ok: false, code: "runtime.version", reason: "Ollama 0.16.0 is too old." },
        },
      }
    }
    return {
      ok: true,
      status: 200,
      data: ready
        ? { enabled: true, check: { ok: true, models: ["qwen3:8b"], left: [] } }
        : {
            enabled: true,
            check: { ok: false, code: "runtime.unreachable", reason: "Nothing answered." },
          },
    }
  }),
}))

beforeEach(() => {
  sent.length = 0
  puts.length = 0
  ready = true
  useStore.setState({ sessions: {}, transcripts: {}, panes: [], route: "chat" })
})
afterEach(cleanup)

describe("models on this computer", () => {
  it("are offered in Start a chat when ready, and start a local chat with no research", async () => {
    render(<NewChat />)
    const option = await screen.findByRole("option", { name: "qwen3:8b" })
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: (option as HTMLOptionElement).value },
    })
    expect((screen.getByRole("checkbox", { name: /Research/ }) as HTMLInputElement).disabled).toBe(
      true,
    )
    fireEvent.change(screen.getByLabelText("What do you want to talk about?"), {
      target: { value: "Explain this repo" },
    })
    // B19: its licence is shown first, and ticked.
    fireEvent.click(await screen.findByRole("checkbox", { name: /I have read the licence/ }))
    fireEvent.click(screen.getByRole("button", { name: "Start the chat" }))
    await waitFor(() =>
      expect(sent[0]).toMatchObject({
        type: "create_session",
        kind: "chat",
        localModel: "qwen3:8b",
      }),
    )
    expect(sent[0]).not.toHaveProperty("model")
    expect(sent[0]).not.toHaveProperty("research")
  })

  it("are not offered when the runtime is not ready", async () => {
    ready = false
    render(<NewChat />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole("option", { name: "qwen3:8b" })).toBeNull()
  })

  it("are set up in Settings, with what the check found", async () => {
    const onSaved = vi.fn()
    render(<ProvidersPanel onSaved={onSaved} />)
    fireEvent.click(await screen.findByRole("checkbox", { name: /Offer these models/ }))
    fireEvent.change(screen.getByRole("textbox", { name: /Models you allow/ }), {
      target: { value: `qwen3:8b sha256:${"a".repeat(64)}\nllama3` },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save and check" }))
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/Not ready: Ollama 0.16.0 is too old/),
    )
    expect(puts[0]).toMatchObject({
      enabled: expect.any(Boolean),
      local: {
        kind: "ollama",
        url: "http://127.0.0.1:11434",
        models: [{ name: "qwen3:8b", digest: `sha256:${"a".repeat(64)}` }, { name: "llama3" }],
      },
    })
    expect(onSaved).toHaveBeenCalled()
  })
})
