import type { ArtifactClient } from "@gatehouse/companion"
import { ArtifactError, type ArtifactStore } from "./artifacts.js"
import type { HostAudit } from "./hostaudit.js"

export interface ArtifactClientDeps {
  store: ArtifactStore
  audit: HostAudit
  sessionId: string
  cwd: string
  policyHash: () => string
}

/**
 * What a chat may do with artifacts, as the Companion's tool (owner's plan, W1-09). Each version is in the audit log
 * by its id, version, kind and size, never its content, and a version that cannot be recorded is taken back out and
 * refused (invariant 13).
 */
export function chatArtifactClient(d: ArtifactClientDeps): ArtifactClient {
  return {
    async save(title, kind, content) {
      try {
        const saved = await d.store.save(d.sessionId, title, kind, content)
        const written = await d.audit.record({
          session: d.sessionId,
          event: "artifact_saved",
          channel: "host",
          tool: "artifacts",
          cwd: d.cwd,
          input: {
            id: saved.id,
            version: saved.version.version,
            kind: saved.kind,
            bytes: saved.version.bytes,
          },
          verdict: {
            outcome: "allow",
            ruleId: "artifact-saved",
            reason: "A chat saved an artifact to show in a sandbox.",
            risk: 0,
            decidedBy: "rules",
            policyHash: d.policyHash(),
          },
          latencyMs: 0,
        })
        if (!written) {
          await d.store.discard(d.sessionId, saved.id, saved.version.version).catch(() => undefined)
          return { text: "Not saved: it could not be recorded.", isError: true }
        }
        return {
          text: `Saved "${saved.title}", version ${saved.version.version}. The person sees it in the Artifacts panel beside this chat. To change it, save again with the same title.`,
        }
      } catch (e) {
        return {
          text:
            e instanceof ArtifactError ? e.message : "The artifact could not be saved just now.",
          isError: true,
        }
      }
    },
  }
}
