/**
 * E-023 (expansion, Wave E1): an agent's edit to a Kubernetes manifest or Helm values that adds a dangerous setting
 * goes to a person, naming it. Severe, and so held: a privileged container, a hostPath volume, hostNetwork or hostPID,
 * running as root (runAsUser 0, runAsNonRoot false), allowing privilege escalation, and a Secret written in plain text
 * (stringData). Noted beside them, but not held on their own: an image on the latest tag, and no resource limits.
 * Only what the edit adds counts: a setting the file had before is not found again. Read from the text; no parser
 * runs over it, so a value written another way than these is not seen (a known limit).
 */
import fs from "node:fs"

export const K8S_RULE = "kubernetes-manifest"
export const K8S_RISK = 85

export interface K8sFinding {
  ruleId: typeof K8S_RULE
  reason: string
  risk: number
}

const SEVERE: Array<{ re: RegExp; what: string }> = [
  { re: /^\s*privileged:\s*true\b/im, what: "a privileged container" },
  { re: /^\s*hostPath:\s*$/im, what: "a hostPath volume (a folder of the node itself)" },
  { re: /^\s*hostNetwork:\s*true\b/im, what: "hostNetwork (the node's own network)" },
  { re: /^\s*hostPID:\s*true\b/im, what: "hostPID (the node's processes)" },
  { re: /^\s*runAsUser:\s*0\s*$/im, what: "running as root (runAsUser 0)" },
  { re: /^\s*runAsNonRoot:\s*false\b/im, what: "running as root allowed (runAsNonRoot false)" },
  { re: /^\s*allowPrivilegeEscalation:\s*true\b/im, what: "privilege escalation allowed" },
]
const NOTED: Array<{ re: RegExp; what: string }> = [
  { re: /^\s*image:\s*["']?[^\s"']+:latest["']?\s*$/im, what: "an image on the latest tag" },
]

/** Whether a file is a Kubernetes manifest or Helm values, by its name and its words. */
export function isK8sFile(file: string, text: string): boolean {
  if (!/\.(ya?ml)$/i.test(file)) return false
  if (/(^|[\\/])values[^\\/]*\.ya?ml$/i.test(file)) return true
  return /^\s*apiVersion:/m.test(text) && /^\s*kind:/m.test(text)
}

/** A plain-text Secret: kind Secret with stringData. */
const plainSecret = (t: string) => /^\s*kind:\s*Secret\b/m.test(t) && /^\s*stringData:/m.test(t)

function added(before: string, after: string): string[] {
  const out = SEVERE.filter((p) => p.re.test(after) && !p.re.test(before)).map((p) => p.what)
  if (plainSecret(after) && !plainSecret(before)) out.push("a Secret in plain text (stringData)")
  return out
}

function noted(before: string, after: string): string[] {
  const out = NOTED.filter((p) => p.re.test(after) && !p.re.test(before)).map((p) => p.what)
  // A container added with no limits: "containers:" in what is new, and no "limits:" in it.
  if (/^\s*containers:\s*$/m.test(after) && !/^\s*limits:\s*$/m.test(after) && !/^\s*containers:\s*$/m.test(before)) out.push("no resource limits")
  return out
}

const current = (abs: string | undefined): string => {
  if (!abs) return ""
  try {
    return fs.readFileSync(abs, "utf8")
  } catch {
    return ""
  }
}

/** What an edit to a manifest adds that is dangerous, held at Severe; undefined when it adds nothing of that. */
export function k8sFindings(tool: string, input: Record<string, unknown>, absPath: string | undefined): K8sFinding | undefined {
  const file = typeof input.file_path === "string" ? input.file_path : ""
  if (!file) return undefined
  let before = ""
  let after = ""
  if (tool === "Write") {
    after = typeof input.content === "string" ? input.content : ""
    before = current(absPath)
  } else if (tool === "Edit") {
    before = typeof input.old_string === "string" ? input.old_string : ""
    after = typeof input.new_string === "string" ? input.new_string : ""
  } else if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const edits = input.edits as Array<{ old_string?: unknown; new_string?: unknown }>
    before = edits.map((e) => (typeof e.old_string === "string" ? e.old_string : "")).join("\n")
    after = edits.map((e) => (typeof e.new_string === "string" ? e.new_string : "")).join("\n")
  } else return undefined
  // An Edit's text is a piece of the file, so the file as it is decides whether it is a manifest.
  if (!isK8sFile(file, `${current(absPath)}\n${after}`)) return undefined
  const severe = added(before, after)
  if (!severe.length) return undefined
  const also = noted(before, after)
  return {
    ruleId: K8S_RULE,
    reason: `This edit to a Kubernetes manifest adds ${severe.join(", ")}${also.length ? ` (and ${also.join(", ")})` : ""}, so it is Severe and waits for you.`,
    risk: K8S_RISK,
  }
}
