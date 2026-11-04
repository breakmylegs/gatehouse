// @vitest-environment jsdom
// B39: a plugin's evaluation is saved, then run, and shows the pass rate with the plugin and without it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PluginEval, rate } from "../src/components/PluginEval"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let suites: unknown[] = []
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (method === "GET") return { ok: true, status: 200, data: { suites } }
    if (url.endsWith("/run"))
      return {
        ok: true,
        status: 200,
        data: { run: { startedAt: "x", state: "running", total: 2, results: [] } },
      }
    return { ok: true, status: 200, data: {} }
  }),
}))
afterEach(() => {
  cleanup()
  calls.length = 0
})

describe("a plugin's evaluation", () => {
  it("gives each side's pass rate", () => {
    const rs = [
      { task: 0, with: true, passed: true },
      { task: 0, with: false, passed: false },
      { task: 1, with: true, passed: true },
      { task: 1, with: false, passed: true },
    ]
    expect(rate(rs, true)).toBe("2 of 2 passed (100%)")
    expect(rate(rs, false)).toBe("1 of 2 passed (50%)")
    expect(rate([], true)).toBe("not run yet")
  })

  it("saves the tasks before it runs them", async () => {
    suites = []
    render(<PluginEval plugin="helper@local" name="helper" />)
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "C:\\dev\\x" } })
    fireEvent.change(screen.getByLabelText("Task 1"), { target: { value: "How is it built?" } })
    fireEvent.change(screen.getByLabelText("A good answer says"), { target: { value: "vite" } })
    fireEvent.click(screen.getByRole("button", { name: "Run the evaluation" }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/run"))).toBe(true))
    const put = calls.findIndex((c) => c.method === "PUT")
    expect(calls[put]?.body).toEqual({
      plugin: "helper@local",
      folder: "C:\\dev\\x",
      tasks: [{ prompt: "How is it built?", expect: "vite" }],
    })
    expect(put).toBeLessThan(calls.findIndex((c) => c.url.endsWith("/run")))
    expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy()
  })

  it("shows the last run's results and why a run gave no answer", async () => {
    suites = [
      {
        plugin: "helper@local",
        folder: "C:\\dev\\x",
        tasks: [{ prompt: "p", expect: "e" }],
        last: {
          startedAt: "2026-11-04T09:00:00Z",
          finishedAt: "2026-11-04T09:05:00Z",
          state: "done",
          total: 2,
          results: [
            { task: 0, with: true, passed: true },
            { task: 0, with: false, passed: false, error: "It did not start: signed out" },
          ],
        },
      },
    ]
    render(<PluginEval plugin="helper@local" name="helper" />)
    expect(await screen.findByText(/1 of 1 passed \(100%\)/)).toBeTruthy()
    expect(screen.getByText(/0 of 1 passed \(0%\)/)).toBeTruthy()
    expect(screen.getByText(/Task 1, without it: It did not start: signed out/)).toBeTruthy()
    expect((screen.getByLabelText("Task 1") as HTMLTextAreaElement).value).toBe("p")
  })
})
