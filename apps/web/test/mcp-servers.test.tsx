// @vitest-environment jsdom
// O39, the MCP page and /mcp: servers are listed with how they stand, made, started and limited from the page, and
// /mcp completes the name of a running server.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mcpMatches, type BuiltServerView } from "../src/lib/mcpServers"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let servers: BuiltServerView[] = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, ...(body !== undefined ? { body } : {}) })
    if (method === "GET" && url === "/api/mcp-servers") return { ok: true, status: 200, data: { servers } }
    return { ok: true, status: 200, data: {} }
  }),
}))
const { McpServers } = await import("../src/surfaces/McpServers")

const server = (o: Partial<BuiltServerView>): BuiltServerView => ({
  name: "greeter",
  autostart: false,
  cpu: 20,
  memoryMb: 512,
  entry: "server.cjs",
  state: "stopped",
  tools: [],
  limited: true,
  ...o,
})

beforeEach(() => {
  calls.length = 0
  servers = []
})
afterEach(cleanup)

describe("the MCP page (O39)", () => {
  it("makes a server from a name, and starts one", async () => {
    servers = [server({})]
    render(<McpServers />)
    const row = await screen.findByRole("listitem", { name: "MCP server greeter" })
    fireEvent.click(within(row).getByRole("button", { name: "Start" }))
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", url: "/api/mcp-servers/greeter/start", body: {} }))
    fireEvent.change(screen.getByPlaceholderText("weather-lookup"), { target: { value: "Weather Look!" } })
    expect((screen.getByPlaceholderText("weather-lookup") as HTMLInputElement).value).toBe("weatherlook")
    fireEvent.click(screen.getByRole("button", { name: "Make it" }))
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", url: "/api/mcp-servers", body: { name: "weatherlook" } }))
  })

  it("shows what a running server offers, why one did not start, and changes its limits", async () => {
    servers = [
      server({ state: "running", tools: [{ name: "hello" }] }),
      server({ name: "broken", state: "failed", error: "Cannot find module 'x'" }),
    ]
    render(<McpServers />)
    const row = await screen.findByRole("listitem", { name: "MCP server greeter" })
    expect(row.textContent).toContain("1 tool: hello")
    expect(within(row).getByRole("button", { name: "Stop" })).toBeTruthy()
    expect(screen.getByText("Cannot find module 'x'")).toBeTruthy()
    fireEvent.change(within(row).getByLabelText("Memory"), { target: { value: "1024" } })
    await waitFor(() => expect(calls).toContainEqual({ method: "PUT", url: "/api/mcp-servers/greeter", body: { memoryMb: 1024 } }))
    fireEvent.click(within(row).getByLabelText("Start with Codehouse"))
    await waitFor(() => expect(calls).toContainEqual({ method: "PUT", url: "/api/mcp-servers/greeter", body: { autostart: true } }))
  })
})

describe("/mcp in a code session (O39)", () => {
  it("completes the name of a running server, and offers none that is stopped", () => {
    const list = [
      server({ name: "greeter", state: "running", tools: [{ name: "hello" }] }),
      server({ name: "grid", state: "stopped" }),
      server({ name: "weather", state: "running", tools: [{ name: "now" }, { name: "week" }] }),
    ]
    expect(mcpMatches("/mcp gr", list).map((m) => m.cmd)).toEqual(["/mcp greeter"])
    expect(mcpMatches("/mcp", list).map((m) => m.cmd)).toEqual(["/mcp greeter", "/mcp weather"])
    expect(mcpMatches("/mcp w", list)[0]?.help).toBe("2 tools: now, week")
    expect(mcpMatches("/model x", list)).toEqual([])
    expect(mcpMatches("/mcp greeter more", list)).toEqual([])
  })
})
