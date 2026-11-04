import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { toast } from "sonner"
import { api } from "./api"
import { send, useStore } from "../store"

/**
 * B29: run the project's tests until they pass. The test command is worked out from the project's own files, set as the
 * session's goal (B25), and Claude is asked to run it and fix what fails. Every command still goes through your rules,
 * so nothing runs that they would not let through; Remember can let the test command through without asking.
 */
const read = async (sessionId: string, rel: string) => {
  const r = await api<{ kind: string; text?: string }>(
    "GET",
    `/api/files/read?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(rel)}`,
  )
  return r.ok && r.data?.kind === "text" ? (r.data.text ?? "") : undefined
}

/** The project's test command, from its own files, or undefined when none can be found. */
export async function testCommand(sessionId: string): Promise<string | undefined> {
  const pkg = await read(sessionId, "package.json")
  if (pkg !== undefined) {
    try {
      const scripts = (JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts ?? {}
      if (typeof scripts.test === "string" && !/no test specified/.test(scripts.test)) {
        // The project's own package manager, by its lock file.
        if ((await read(sessionId, "pnpm-lock.yaml")) !== undefined) return "pnpm test"
        if ((await read(sessionId, "yarn.lock")) !== undefined) return "yarn test"
        return "npm test"
      }
    } catch {
      // not JSON: look for another kind of project
    }
  }
  if ((await read(sessionId, "pyproject.toml")) !== undefined) return "pytest"
  if ((await read(sessionId, "Cargo.toml")) !== undefined) return "cargo test"
  if ((await read(sessionId, "go.mod")) !== undefined) return "go test ./..."
  return undefined
}

export async function runTestsUntilPass(s: SessionInfo): Promise<void> {
  const cmd = await testCommand(s.id)
  if (!cmd) {
    toast(
      "No test command was found in this project (package.json, pyproject.toml, Cargo.toml or go.mod).",
      {
        id: "tests",
      },
    )
    return
  }
  const goal = await send({ type: "set_goal", sessionId: s.id, check: cmd })
  if (!goal.ok) {
    toast.error(goal.error?.message ?? "The goal was not set", { id: "tests" })
    return
  }
  const text = `Run ${cmd}. If anything fails, find out why and fix it, then run ${cmd} again, until it passes. When it passes, end your reply with the line GOAL MET.`
  const st = useStore.getState()
  const working = s.state === "running" || s.state === "waiting"
  st.addUserText(s.id, text, undefined, working)
  void send({ type: "prompt", sessionId: s.id, text })
  toast(
    s.extreme
      ? `Running ${cmd} until it passes; it carries on by itself within your limits.`
      : `Asked Claude to run ${cmd} until it passes.`,
    { id: "tests" },
  )
}
