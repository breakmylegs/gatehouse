/**
 * E-100 (expansion, Wave E1): invariant canaries. At every start of the Host (so after each update too) and once a
 * day, with no model and no session, they prove on this installed build that the protections hold:
 *   floor      the floor denies a Read of a canary .env
 *   redaction  a canary secret is masked
 *   approver   the Approver client fails closed (escalate, never allow) on a wrong token and on a timeout
 *   listener   the Host refuses a request with no token, with a wrong Host and with a foreign Origin
 *   audit      a canary audit chain verifies with both verifiers (Node and PowerShell), and a tampered one does not
 *   org        the organisation guard refuses a fake account
 *   mcp        the in-process check refuses a stdio server
 *   managed    the managed policy loader refuses a tampered file
 * Any failure blocks new sessions (SessionManager.start), names the canary and shows Doctor guidance. Each check's
 * function can be replaced, so a test can break each one and see its canary fail.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { evaluateFloor, loadPolicy, MANAGED_ERROR, redactString, type Policy, type PwshWorker } from "@gatehouse/policy"
import { AuditWriter, verifyAudit } from "@gatehouse/shared/audit"
import { checkOrg } from "./account.js"
import { ApproverClient } from "./approver-client.js"
import { outOfProcessServers } from "./safety.js"
import { checkHostRequest } from "./server-guard.js"
import { runPowerShellVerifier } from "./timeline-export.js"

export type CanaryId = "floor" | "redaction" | "approver" | "listener" | "audit" | "org" | "mcp" | "managed"

export interface CanaryResult {
  id: CanaryId
  label: string
  ok: boolean
  detail: string
}

export interface CanaryRun {
  at: string
  ms: number
  passed: number
  failed: number
  results: CanaryResult[]
}

/** The checks the canaries call; each can be replaced in a test to break it. */
export interface CanaryFns {
  evaluateFloor: typeof evaluateFloor
  redactString: typeof redactString
  checkHostRequest: typeof checkHostRequest
  checkOrg: typeof checkOrg
  outOfProcessServers: typeof outOfProcessServers
  verifyAudit: typeof verifyAudit
  powerShellVerifier: typeof runPowerShellVerifier
  loadPolicy: typeof loadPolicy
  approver: (o: { url: string; token: string; timeoutMs: number }) => Pick<ApproverClient, "evaluate">
}

export interface CanaryDeps {
  /** The live policy, as the floor hook uses it. */
  policy: () => Policy | undefined
  pwsh?: PwshWorker
  /** The shipped rules file, for the managed policy canary. */
  rulesPath: string
  /** The running Approver, asked once with a wrong token. */
  approverUrl?: string
  /** The PowerShell audit verifier (scripts/verify-audit.ps1). */
  psVerifier: string
  platform?: NodeJS.Platform
  fns?: Partial<CanaryFns>
}

const DEFAULTS: CanaryFns = {
  evaluateFloor,
  redactString,
  checkHostRequest,
  checkOrg,
  outOfProcessServers,
  verifyAudit,
  powerShellVerifier: runPowerShellVerifier,
  loadPolicy,
  approver: (o) => new ApproverClient(o),
}

const LABELS: Record<CanaryId, string> = {
  floor: "The floor denies a secrets file",
  redaction: "Redaction masks a secret",
  approver: "The Approver fails closed",
  listener: "The Host refuses strangers",
  audit: "The audit chain verifies",
  org: "The organisation guard refuses a fake account",
  mcp: "Out-of-process MCP servers are refused",
  managed: "A tampered managed policy is refused",
}

/** What Doctor says to do when a canary fails. */
export const CANARY_FIX: Record<CanaryId, string> = {
  floor: "The policy is missing or its floor rules do not load. Check Settings, Policy, and reinstall Codehouse if it stays.",
  redaction: "Redaction is not working, so nothing is safe to record or send. Reinstall Codehouse.",
  approver: "The Approver answered a call it should have refused. Restart Codehouse; reinstall if it stays.",
  listener: "The Host's listener accepted a request it should refuse. Restart Codehouse; reinstall if it stays.",
  audit: "An audit verifier did not check a known chain correctly. Reinstall Codehouse; on a Mac, install PowerShell 7.",
  org: "The organisation guard let a fake account through. Reinstall Codehouse.",
  mcp: "The check that keeps MCP servers in process did not refuse one. Reinstall Codehouse.",
  managed: "A tampered managed policy was not refused. Reinstall Codehouse and tell your IT team.",
}

const result = (id: CanaryId, ok: boolean, detail: string): CanaryResult => ({ id, label: LABELS[id], ok, detail })

async function attempt(id: CanaryId, fn: () => Promise<string | true> | string | true): Promise<CanaryResult> {
  try {
    const r = await fn()
    return r === true ? result(id, true, "As it should.") : result(id, false, r)
  } catch (e) {
    return result(id, false, `It could not be checked: ${(e as Error).message}`)
  }
}

/** Runs every canary, at once where they can be, in a temp folder of their own that is removed after. */
export async function runCanaries(d: CanaryDeps): Promise<CanaryRun> {
  const f = { ...DEFAULTS, ...d.fns }
  const started = Date.now()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-canary-"))
  try {
    const results = await Promise.all([
      attempt("floor", async () => {
        const policy = d.policy()
        if (!policy) return "No policy is loaded, so the floor cannot run."
        const hit = await f.evaluateFloor(policy, { toolName: "Read", input: { file_path: path.join(dir, ".env") } }, { cwd: dir }, d.pwsh)
        return hit ? true : "A Read of a .env file was not denied."
      }),
      attempt("redaction", () => {
        const secret = ["sk-ant-", "canary", crypto.randomBytes(12).toString("hex")].join("")
        return f.redactString(`key: ${secret}`).includes(secret) ? "A canary API key came through unmasked." : true
      }),
      attempt("approver", async () => {
        const call = { toolName: "Bash", input: { command: "git status" } }
        const ctx = { cwd: dir, sessionId: "canary" }
        if (d.approverUrl) {
          const wrong = await f.approver({ url: d.approverUrl, token: crypto.randomBytes(16).toString("hex"), timeoutMs: 2000 }).evaluate(call, ctx)
          if (wrong.outcome === "allow") return "With a wrong token, the Approver's answer was allow."
        }
        // A server that takes the request and never answers.
        const silent = http.createServer(() => undefined)
        await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r))
        try {
          const port = (silent.address() as { port: number }).port
          const slow = await f.approver({ url: `http://127.0.0.1:${port}`, token: "canary", timeoutMs: 300 }).evaluate(call, ctx)
          return slow.outcome === "allow" ? "When the Approver timed out, the answer was allow." : true
        } finally {
          silent.closeAllConnections()
          silent.close()
        }
      }),
      attempt("listener", () => {
        const token = crypto.randomBytes(16).toString("hex")
        const port = 47820
        const host = `127.0.0.1:${port}`
        const noToken = f.checkHostRequest({ method: "GET", url: "/api/health", headers: { host } }, { token, port })
        const wrongHost = f.checkHostRequest({ method: "GET", url: "/api/health", headers: { host: "evil.example:47820", authorization: `Bearer ${token}` } }, { token, port })
        const origin = f.checkHostRequest({ method: "GET", url: "/api/health", headers: { host, origin: "https://evil.example", authorization: `Bearer ${token}` } }, { token, port })
        const refused = (r: { ok: boolean }) => r.ok === false
        if (!refused(noToken)) return "A request with no token was let in."
        if (!refused(wrongHost)) return "A request with a wrong Host header was let in."
        if (!refused(origin)) return "A request from another site was let in."
        return true
      }),
      attempt("audit", async () => {
        const chain = path.join(dir, "audit")
        const writer = new AuditWriter({ dir: chain, redact: (x) => x })
        for (const n of [1, 2])
          await writer.append({
            session: "canary",
            event: "canary_record",
            channel: "host",
            tool: "canary",
            input: { n },
            verdict: { outcome: "allow", ruleId: "canary", reason: "A canary record.", risk: 0, decidedBy: "rules", policyHash: "" },
            latencyMs: 0,
          })
        if (!f.verifyAudit(chain).ok) return "The Node verifier refused a good chain."
        const ps = await f.powerShellVerifier(d.psVerifier, chain)
        const platform = d.platform ?? process.platform
        if (ps.ok === false) return "The PowerShell verifier refused a good chain."
        if (ps.ok === null && platform === "win32") return `The PowerShell verifier did not answer: ${ps.error ?? ""}`.trim()
        // One byte changed in the chain: the Node verifier must see it.
        const file = fs.readdirSync(chain).find((n) => n.endsWith(".jsonl"))
        if (!file) return "The canary chain was not written."
        const at = path.join(chain, file)
        const before = fs.readFileSync(at, "utf8")
        const after = before.replace("canary_record", "canary_recorX")
        if (after === before) return "The canary chain could not be changed to test the verifier."
        fs.writeFileSync(at, after)
        if (f.verifyAudit(chain).ok) return "The Node verifier accepted a tampered chain."
        return true
      }),
      attempt("org", () => {
        const fake = { email: "canary@example.invalid", organization: "Canary Org", apiProvider: "firstParty" }
        return f.checkOrg(fake as never, "the-expected-organisation").ok ? "A fake account passed the organisation guard." : true
      }),
      attempt("mcp", () =>
        f.outOfProcessServers([{ name: "canary", status: "connected", config: { type: "stdio", command: "canary" } }]).includes("canary")
          ? true
          : "A stdio MCP server was not refused.",
      ),
      attempt("managed", () => {
        const managed = path.join(dir, "managed")
        fs.mkdirSync(managed)
        const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
        const yaml = Buffer.from("deny: []\n")
        fs.writeFileSync(path.join(managed, "policy.yaml"), yaml)
        fs.writeFileSync(path.join(managed, "policy.yaml.sig"), crypto.sign(null, yaml, privateKey).toString("base64"))
        fs.writeFileSync(path.join(managed, "key" + ".pem"), publicKey.export({ format: "pem", type: "spki" }))
        // Changed after signing.
        fs.writeFileSync(path.join(managed, "policy.yaml"), "deny: []\nescalate: []\n")
        try {
          f.loadPolicy({ rulesPath: d.rulesPath, managedDir: managed, overlayDir: path.join(dir, "none") })
          return "A managed policy changed after signing was loaded."
        } catch (e) {
          const errors = (e as { errors?: string[] }).errors ?? []
          return errors.some((x) => x.startsWith(MANAGED_ERROR)) ? true : `It failed to load for another reason: ${errors[0] ?? (e as Error).message}`
        }
      }),
    ])
    const failed = results.filter((r) => !r.ok).length
    return { at: new Date(started).toISOString(), ms: Date.now() - started, passed: results.length - failed, failed, results }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** The reason sessions are refused while a canary fails, naming them; undefined when all passed. */
export function canaryProblem(run: CanaryRun | undefined): string | undefined {
  const bad = run?.results.filter((r) => !r.ok) ?? []
  if (!bad.length) return undefined
  return `A safety check failed when Codehouse started, so no session starts until it passes: ${bad.map((r) => `${r.label} (${r.detail})`).join("; ")}. Open Doctor for what to do.`
}
