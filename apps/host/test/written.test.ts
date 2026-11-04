// A file the session wrote or edited is remembered, so its pane can open it even outside the folder (owner, 4 Nov).
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createPostToolHook, type SessionHookDeps } from "../src/hooks.js"
import { writtenKey } from "../src/sessions.js"
import type { HostAudit } from "../src/hostaudit.js"

const deps = (onWritten: (f: string) => void): SessionHookDeps =>
  ({
    sessionId: "s1",
    cwd: "C:/dev/shop",
    policy: () => undefined,
    pwsh: undefined,
    audit: { record: async () => true } as unknown as HostAudit,
    kill: () => false,
    decided: new Set(["t1", "t2", "t3", "t4"]),
    onEvent: () => undefined,
    log: () => undefined,
    onWritten,
  }) as SessionHookDeps

const post = (name: string, input: Record<string, unknown>, id: string, event = "PostToolUse") =>
  ({
    hook_event_name: event,
    tool_name: name,
    tool_input: input,
    tool_use_id: id,
    tool_response: {},
    cwd: "C:/dev/shop",
  }) as never

describe("what a session wrote", () => {
  it("is noted for Write, Edit and NotebookEdit, and not for a read, a command or a failed write", async () => {
    const seen: string[] = []
    const hook = createPostToolHook(deps((f) => seen.push(f)))
    const signal = new AbortController().signal
    await hook(post("Write", { file_path: "C:/Users/me/Documents/plan.md" }, "t1"), "t1", {
      signal,
    })
    await hook(post("Edit", { file_path: "notes.md" }, "t2"), "t2", { signal })
    await hook(post("NotebookEdit", { notebook_path: "C:/dev/shop/a.ipynb" }, "t3"), "t3", {
      signal,
    })
    await hook(post("Read", { file_path: "C:/secret.txt" }, "t4"), "t4", { signal })
    await hook(post("Write", { file_path: "C:/failed.md" }, "t1", "PostToolUseFailure"), "t1", {
      signal,
    })
    expect(seen).toEqual(["C:/Users/me/Documents/plan.md", "notes.md", "C:/dev/shop/a.ipynb"])
  })

  it("is kept by full path, resolved against the session folder, ignoring case", () => {
    expect(writtenKey("notes.md", "C:/dev/shop")).toBe(
      path.resolve("C:/dev/shop", "notes.md").toLowerCase(),
    )
    expect(writtenKey("C:/Users/Me/Plan.md", "C:/dev/shop")).toBe(
      path.resolve("C:/Users/Me/Plan.md").toLowerCase(),
    )
  })
})
