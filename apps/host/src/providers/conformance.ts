import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { inputHash } from "./gate.js"
import { handleToolRequest, type Executor } from "./loop.js"
import { bypassIn } from "./registry.js"
import type { Gate, GateVerdict, ProviderAdapter, ToolCall } from "./types.js"

/**
 * The invariant conformance suite (S-04): what every provider must pass before it may be switched on. Each check
 * runs the provider's own pieces (its adapter, the way it wraps a gate, its executor) against a gate that misbehaves
 * on purpose, and looks at the file system, not only at what was said, to see whether a tool ran.
 *
 * Covered here: fail closed on a gate error, a stuck gate and a malformed answer (invariant 1); no way to approve by
 * itself (invariant 3); only the allowed input runs (invariant 10, T-10); results redacted (invariant 12); the
 * organisation checked (invariant 14). The audit log and the local listeners are the same for every provider (the
 * gate's canUseTool records each decision; providers open no listener), so their existing tests are not repeated.
 */

export type Category =
  | "gate-error"
  | "gate-timeout"
  | "gate-malformed"
  | "no-bypass"
  | "edited-input"
  | "redaction"
  | "org-guard"

export interface ConformanceSubject {
  adapter: ProviderAdapter
  /** How the provider wraps the gate it is given, with the timeout it would use set to this. */
  wrapGate: (inner: Gate, timeoutMs: number) => Gate
  /** The provider's executor for a folder, redacting this term. */
  executor: (workspaceRoot: string, secret: string) => Executor
  /** An organisation the adapter's account is in, and one it is not. */
  orgs: { expected: string; other: string }
}

export interface Finding {
  category: Category
  ok: boolean
  detail: string
}

const SECRET = "Project Falcon"
const TIMEOUT_MS = 300

export async function runConformance(s: ConformanceSubject): Promise<Finding[]> {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-conform-")))
  const findings: Finding[] = []
  const say = (category: Category, ok: boolean, detail: string) =>
    findings.push({ category, ok, detail })
  const sentinel = path.join(root, "sentinel.txt")
  let n = 0
  const writeCall = (file = sentinel): ToolCall => ({
    callId: `call-${++n}`,
    sessionId: "conformance",
    provider: s.adapter.id,
    tool: "write",
    vendorToolName: "write_file",
    input: { file_path: file, content: "ran" },
  })
  /** Runs one write through the provider's gate and executor; whether it was denied, and whether it ran. */
  const attempt = async (inner: Gate, call = writeCall()) => {
    fs.rmSync(sentinel, { force: true })
    const gate = s.wrapGate(inner, TIMEOUT_MS)
    const ac = new AbortController()
    const guard = setTimeout(() => ac.abort(), TIMEOUT_MS * 10)
    try {
      const decided = await Promise.race([
        gate.decide(call, ac.signal).then((v) => v.kind),
        new Promise<"stuck">((r) => setTimeout(() => r("stuck"), TIMEOUT_MS * 10)),
      ])
      const result = await Promise.race([
        handleToolRequest(call, gate, s.executor(root, SECRET), ac.signal).catch(() => undefined),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), TIMEOUT_MS * 10)),
      ])
      return { decided, ran: fs.existsSync(call.input.file_path as string), result }
    } catch {
      return {
        decided: "threw" as const,
        ran: fs.existsSync(call.input.file_path as string),
        result: undefined,
      }
    } finally {
      clearTimeout(guard)
    }
  }
  try {
    {
      const r = await attempt({ decide: () => Promise.reject(new Error("broken gate")) })
      say("gate-error", r.decided === "deny" && !r.ran, `decided ${r.decided}, ran ${r.ran}`)
    }
    {
      const r = await attempt({ decide: () => new Promise<GateVerdict>(() => undefined) })
      say("gate-timeout", r.decided === "deny" && !r.ran, `decided ${r.decided}, ran ${r.ran}`)
    }
    {
      const bad = [
        (c: ToolCall) =>
          ({ kind: "allow", callId: c.callId, input: c.input }) as unknown as GateVerdict,
        (c: ToolCall) =>
          ({ kind: "allow", callId: c.callId, input: c.input, inputHash: "0" }) as GateVerdict,
        (c: ToolCall) =>
          ({
            kind: "allow",
            callId: "another",
            input: c.input,
            inputHash: inputHash(c.input),
          }) as GateVerdict,
        () => ({ yes: true }) as unknown as GateVerdict,
      ]
      const results = []
      for (const make of bad)
        results.push(await attempt({ decide: (c) => Promise.resolve(make(c)) }))
      say(
        "gate-malformed",
        results.every((r) => r.decided === "deny" && !r.ran),
        results.map((r) => `${r.decided}/${r.ran}`).join(", "),
      )
    }
    {
      const why = bypassIn(s.adapter.capabilities())
      say("no-bypass", !why, why ?? "no setting approves by itself")
    }
    {
      // A person moved the write elsewhere: only the edited file may be written.
      const edited = path.join(root, "edited.txt")
      const call = writeCall()
      const input = { file_path: edited, content: "ran" }
      fs.rmSync(edited, { force: true })
      const r = await attempt(
        {
          decide: (c) =>
            Promise.resolve({
              kind: "allow",
              callId: c.callId,
              input,
              inputHash: inputHash(input),
            }),
        },
        call,
      )
      const wroteEdited = fs.existsSync(edited)
      say(
        "edited-input",
        wroteEdited && !r.ran,
        `edited written ${wroteEdited}, original written ${r.ran}`,
      )
    }
    {
      const file = path.join(root, "notes.txt")
      fs.writeFileSync(file, `The plan for ${SECRET} is ready.`)
      const call: ToolCall = {
        callId: `call-${++n}`,
        sessionId: "conformance",
        provider: s.adapter.id,
        tool: "read",
        vendorToolName: "read_file",
        input: { file_path: file },
      }
      const allowAll: Gate = {
        decide: (c) =>
          Promise.resolve({
            kind: "allow",
            callId: c.callId,
            input: c.input,
            inputHash: inputHash(c.input),
          }),
      }
      const result = await handleToolRequest(
        call,
        s.wrapGate(allowAll, TIMEOUT_MS),
        s.executor(root, SECRET),
        new AbortController().signal,
      )
      const leaked = result.output.includes(SECRET)
      say(
        "redaction",
        result.ok && !leaked && result.untrusted,
        leaked ? "the term reached the model" : "masked",
      )
    }
    {
      const refused = await s.adapter.assertOrganisation([s.orgs.other]).then(
        () => false,
        () => true,
      )
      const accepted = await s.adapter.assertOrganisation([s.orgs.expected]).then(
        () => true,
        () => false,
      )
      say(
        "org-guard",
        refused && accepted,
        `other refused ${refused}, expected accepted ${accepted}`,
      )
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
  return findings
}
