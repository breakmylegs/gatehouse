import type { MemoryClient, ToolText } from "@gatehouse/companion"
import type { HostAudit } from "./hostaudit.js"
import { MemoryError, type MemoryScope, type MemoryStore } from "./memory.js"

export interface MemoryClientDeps {
  store: MemoryStore
  audit: HostAudit
  sessionId: string
  cwd: string
  /** The chat's project, if it is in one. */
  project: string | undefined
  policyHash: () => string
}

/**
 * What a chat may do with memory, as the Companion's tools: remember, recall and forget (owner's plan, W1-08). Every
 * change is in the audit log by its id, scope and topic, never its words. If a change cannot be recorded it is undone
 * and refused: nothing is remembered or forgotten without a record (invariant 13).
 */
export function chatMemoryClient(d: MemoryClientDeps): MemoryClient {
  const record = (event: string, input: Record<string, unknown>) =>
    d.audit.record({
      session: d.sessionId,
      event,
      channel: "host",
      tool: "memory",
      cwd: d.cwd,
      input,
      verdict: {
        outcome: "allow",
        ruleId: event.replaceAll("_", "-"),
        reason: "A chat changed what chats remember.",
        risk: 0,
        decidedBy: "rules",
        policyHash: d.policyHash(),
      },
      latencyMs: 0,
    })
  const mine = (): MemoryScope[] => [
    { kind: "global" },
    ...(d.project ? [{ kind: "project" as const, name: d.project }] : []),
  ]
  const failed = (e: unknown): ToolText => ({
    text: e instanceof MemoryError ? e.message : "Memory could not be changed just now.",
    isError: true,
  })

  return {
    async remember(topic, text, scope) {
      if (scope === "project" && !d.project)
        return {
          text: "This chat is not in a project, so there is no project memory. Use scope everyone.",
          isError: true,
        }
      const where: MemoryScope =
        scope === "project" && d.project ? { kind: "project", name: d.project } : { kind: "global" }
      try {
        const entry = await d.store.add(where, topic, text, "claude")
        const written = await record("memory_written", {
          id: entry.id,
          scope: where.kind === "global" ? "everyone" : where.name,
          topic: entry.topic,
          characters: entry.text.length,
        })
        if (!written) {
          await d.store.remove(entry.id).catch(() => undefined)
          return { text: "Not remembered: it could not be recorded.", isError: true }
        }
        return {
          text: `Remembered under "${entry.topic}" (id ${entry.id}). The person can change it on the Memory page.`,
        }
      } catch (e) {
        return failed(e)
      }
    },

    recall(topic) {
      const wanted = topic?.trim().toLowerCase()
      const lines = mine()
        .flatMap((s) =>
          d.store.list(s).map((e) => ({ ...e, where: s.kind === "global" ? "everyone" : s.name })),
        )
        .filter((e) => !wanted || e.topic.toLowerCase().includes(wanted))
        .map((e) => `${e.id} [${e.where}] ${e.topic}: ${e.text}`)
      return {
        text: lines.length
          ? lines.join("\n")
          : wanted
            ? `Nothing is remembered under "${topic}".`
            : "Nothing is remembered yet.",
      }
    },

    async forget(id) {
      const found = d.store.find(id.trim())
      // Only what this chat can see: everyone's memory and its own project's.
      const visible =
        found &&
        (found.scope.kind === "global" ||
          (d.project !== undefined && found.scope.name === d.project))
      if (!found || !visible) return { text: "There is no memory with that id.", isError: true }
      try {
        // Recorded first: a record of something that then failed is harmless, a removal with no record is not.
        const written = await record("memory_forgotten", {
          id: found.entry.id,
          scope: found.scope.kind === "global" ? "everyone" : found.scope.name,
          topic: found.entry.topic,
        })
        if (!written) return { text: "Not forgotten: it could not be recorded.", isError: true }
        const removed = await d.store.remove(id.trim())
        return { text: `Forgotten: ${removed.topic}.` }
      } catch (e) {
        return failed(e)
      }
    },
  }
}
