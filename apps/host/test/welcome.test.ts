// T-004: the welcome finds the coding agents on the PATH (Windows extensions and quoted folders too) and the model
// runtimes answering on this computer, asking only 127.0.0.1 and never following a redirect.
import { describe, expect, it } from "vitest"
import { findAgents, findOnPath, findRuntimes, RUNTIMES } from "../src/welcome.js"

describe("what the welcome finds (T-004)", () => {
  it("finds a command on the PATH, with Windows' extensions and quoted folders", () => {
    const have = new Set(["C:\\tools\\bin\\codex.cmd", "/usr/local/bin/gemini"])
    const exists = (p: string) => have.has(p)
    expect(findOnPath("codex", { PATH: 'C:\\nothing;"C:\\tools\\bin"', PATHEXT: ".EXE;.CMD" }, "win32", exists)).toBe("C:\\tools\\bin\\codex.cmd")
    expect(findOnPath("codex", { Path: "C:\\tools\\bin", PATHEXT: ".EXE" }, "win32", exists)).toBeUndefined()
    expect(findOnPath("gemini", { PATH: "/usr/bin:/usr/local/bin" }, "darwin", exists)).toBe("/usr/local/bin/gemini")
    const agents = findAgents({ PATH: "/usr/bin:/usr/local/bin" }, "darwin", exists)
    expect(agents.filter((a) => a.where).map((a) => a.id)).toEqual(["gemini"])
    expect(agents.find((a) => a.id === "claude")).toEqual({ id: "claude", name: "Claude Code" })
  })

  it("asks each runtime on this computer once, without following a redirect, and says which answered", async () => {
    const asked: Array<{ url: string; redirect?: string }> = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      asked.push({ url, ...(init.redirect ? { redirect: init.redirect } : {}) })
      if (url.includes(":11434")) return new Response("{}", { status: 200 })
      if (url.includes(":1234")) return new Response("no", { status: 404 })
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch
    const found = await findRuntimes(fetchFn)
    expect(found.map((r) => [r.name, r.up])).toEqual([
      ["Ollama", true],
      ["LM Studio", false],
      ["llama.cpp server", false],
    ])
    expect(asked).toHaveLength(RUNTIMES.length)
    for (const a of asked) {
      expect(new URL(a.url).hostname).toBe("127.0.0.1")
      expect(a.redirect).toBe("error")
    }
  })
})
