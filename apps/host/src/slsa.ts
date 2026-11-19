import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

/**
 * D-032 (frontier, Insight and evidence): agent-aware build provenance. Each release gets an in-toto Statement v1
 * whose predicate is SLSA provenance v1: the release's files as subjects with their SHA-256, the commit they were built
 * from, and, as byproducts, every agent session whose commits went into it, with the audit record and evidence pack
 * each one's git note names (D-030, D-003). Anyone can check the files against the subjects, and the sessions against
 * the audit chain on the computer that made them.
 */
export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1"
export const PREDICATE_TYPE = "https://slsa.dev/provenance/v1"
export const BUILD_TYPE = "https://github.com/breakmylegs/gatehouse/release/v1"

const Digest = z.record(z.string().regex(/^[a-zA-Z0-9]+$/), z.string().regex(/^[0-9a-f]+$/)).refine((d) => Object.keys(d).length > 0, "a digest names at least one hash")
const ResourceDescriptor = z
  .object({
    uri: z.string().optional(),
    digest: Digest.optional(),
    name: z.string().optional(),
    downloadLocation: z.string().optional(),
    mediaType: z.string().optional(),
    annotations: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((r) => r.uri || r.digest || r.name, "a resource names a uri, a digest or a name")

/** The parts of in-toto Statement v1 and SLSA provenance v1 that are required, as their specifications say. */
export const Statement = z.object({
  _type: z.literal(STATEMENT_TYPE),
  subject: z.array(z.object({ name: z.string().min(1), digest: Digest })).min(1),
  predicateType: z.literal(PREDICATE_TYPE),
  predicate: z.object({
    buildDefinition: z.object({
      buildType: z.string().url(),
      externalParameters: z.record(z.string(), z.unknown()),
      internalParameters: z.record(z.string(), z.unknown()).optional(),
      resolvedDependencies: z.array(ResourceDescriptor).optional(),
    }),
    runDetails: z.object({
      builder: z.object({ id: z.string().url(), version: z.record(z.string(), z.string()).optional() }),
      metadata: z.object({ invocationId: z.string().optional(), startedOn: z.string().datetime().optional(), finishedOn: z.string().datetime().optional() }).optional(),
      byproducts: z.array(ResourceDescriptor).optional(),
    }),
  }),
})
export type Statement = z.infer<typeof Statement>

export interface SessionNote {
  commit: string
  session: string
  auditSeq: number
  auditHash: string
  evidence?: string
}

export const sha256File = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex")

export function buildStatement(o: {
  files: string[]
  repo: string
  tag: string
  commit: string
  version: string
  notes: SessionNote[]
  startedOn: string
  finishedOn: string
}): Statement {
  const sessions = new Map<string, SessionNote[]>()
  for (const n of o.notes) sessions.set(n.session, [...(sessions.get(n.session) ?? []), n])
  return {
    _type: STATEMENT_TYPE,
    subject: o.files.map((f) => ({ name: path.basename(f), digest: { sha256: sha256File(f) } })),
    predicateType: PREDICATE_TYPE,
    predicate: {
      buildDefinition: {
        buildType: BUILD_TYPE,
        externalParameters: { repository: `https://github.com/${o.repo}`, ref: `refs/tags/${o.tag}`, version: o.version },
        internalParameters: { script: "scripts/release.ts ship" },
        resolvedDependencies: [{ uri: `git+https://github.com/${o.repo}@refs/tags/${o.tag}`, digest: { gitCommit: o.commit } }],
      },
      runDetails: {
        builder: { id: `https://github.com/${o.repo}/blob/main/scripts/release.ts` },
        metadata: { invocationId: `${o.tag}@${o.commit}`, startedOn: o.startedOn, finishedOn: o.finishedOn },
        // The agent work in this release: each session, its commits, and the audit and evidence they are tied to.
        byproducts: [...sessions].map(([session, ns]) => ({
          name: `codehouse-session/${session}`,
          digest: { sha256: createHash("sha256").update(JSON.stringify(ns)).digest("hex") },
          annotations: {
            commits: ns.map((n) => n.commit),
            audit: ns.map((n) => ({ seq: n.auditSeq, hash: n.auditHash })),
            evidence: ns.map((n) => n.evidence).filter(Boolean),
          },
        })),
      },
    },
  }
}

/** The statement checked: its shape against the schema, then every subject's hash against its file in `dir`. */
export function verifyStatement(json: unknown, dir: string): { ok: true } | { ok: false; why: string } {
  const p = Statement.safeParse(json)
  if (!p.success) return { ok: false, why: `It is not a SLSA provenance statement: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}` }
  for (const s of p.data.subject) {
    const file = path.join(dir, path.basename(s.name))
    if (!fs.existsSync(file)) return { ok: false, why: `${s.name} is not there.` }
    if (sha256File(file) !== s.digest.sha256) return { ok: false, why: `${s.name} is not the file the statement names.` }
  }
  for (const b of p.data.predicate.runDetails.byproducts ?? []) {
    const a = (b.annotations ?? {}) as { commits?: string[]; audit?: Array<{ seq: number; hash: string }>; evidence?: string[] }
    const ns = (a.commits ?? []).map((commit, i) => ({ commit, session: String(b.name).replace("codehouse-session/", ""), auditSeq: a.audit?.[i]?.seq, auditHash: a.audit?.[i]?.hash, ...(a.evidence?.[i] ? { evidence: a.evidence[i] } : {}) }))
    if (b.digest?.sha256 && createHash("sha256").update(JSON.stringify(ns)).digest("hex") !== b.digest.sha256) return { ok: false, why: `${b.name} does not match its own hash.` }
  }
  return { ok: true }
}

/** The sessions behind a range of commits, from their git notes (refs/notes/codehouse). */
export function sessionNotes(root: string, range: string): SessionNote[] {
  let out = ""
  try {
    out = execFileSync("git", ["-C", root, "log", "--notes=codehouse", "--format=%H%x00%N%x01", range], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  } catch {
    return []
  }
  const notes: SessionNote[] = []
  for (const entry of out.split("\x01")) {
    const [commit, note] = entry.trim().split("\x00")
    if (!commit || !note?.trim()) continue
    try {
      const n = JSON.parse(note.trim()) as { codehouse?: unknown; session?: unknown; auditSeq?: unknown; auditHash?: unknown; evidence?: unknown }
      if (n.codehouse !== 1 || typeof n.session !== "string" || typeof n.auditSeq !== "number" || typeof n.auditHash !== "string") continue
      notes.push({ commit: commit.trim(), session: n.session, auditSeq: n.auditSeq, auditHash: n.auditHash, ...(typeof n.evidence === "string" ? { evidence: n.evidence } : {}) })
    } catch {
      // A note that is not Codehouse's: left out.
    }
  }
  return notes
}
