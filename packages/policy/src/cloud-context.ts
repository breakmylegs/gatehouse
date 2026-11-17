/**
 * E-021 (expansion, Wave E1): a command that changes things with kubectl, helm, az, aws or gcloud, in a context, profile,
 * subscription, project or namespace that looks like production, is Severe. Only the name written in the command or
 * the environment before it is read (--context, --kube-context, --profile, AWS_PROFILE, --subscription, --project,
 * CLOUDSDK_CORE_PROJECT, --namespace): no kubeconfig, credentials or config file is ever opened, so a context chosen
 * elsewhere is not seen, and the change is judged by the cloud rules as before. Looking is never changed by this.
 */
import { looksProduction } from "./database.js"
import type { Segment } from "./segments.js"

export const PROD_CONTEXT_RULE = "production-context"
export const PROD_CONTEXT_RISK = 90

const KUBECTL_CHANGES = new Set(["apply", "delete", "edit", "exec", "scale", "rollout", "patch", "create", "replace", "drain", "cordon", "uncordon", "taint", "label", "annotate", "set", "run", "expose", "autoscale"])
const HELM_CHANGES = new Set(["install", "upgrade", "uninstall", "delete", "rollback"])
// The s3 verbs (remove, move, copy, sync, remove and make a bucket) change things too.
const CLOUD_VERB = /(^|-)(create|delete|update|set|put|deploy|remove|start|stop|restart|apply|attach|detach|modify|terminate|run|scale|assign|import|invoke|reboot|publish|rm|mv|cp|sync|rb|mb)(-|$)/i

const flag = (args: string[], ...names: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    for (const n of names) {
      if (a === n && i + 1 < args.length) return args[i + 1]
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1)
    }
  }
  return undefined
}

function assignments(seg: Segment): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of seg.text.slice(0, Math.max(0, seg.text.length - seg.coreText.length)).matchAll(/(\w+)=(\S+)/g))
    out[m[1]!.toUpperCase()] = m[2]!
  return out
}

/** Whether a cloud command changes something, and the names it is pointed at. */
function cloudCall(seg: Segment): { tool: string; names: string[] } | undefined {
  const tool = seg.name.toLowerCase().replace(/\.(exe|cmd)$/, "")
  const args = seg.args
  const env = assignments(seg)
  const plain = args.filter((a) => !a.startsWith("-"))
  if (tool === "kubectl" || tool === "oc") {
    if (!KUBECTL_CHANGES.has(plain[0] ?? "")) return undefined
    return { tool, names: [flag(args, "--context"), flag(args, "--namespace", "-n"), flag(args, "--cluster")].filter((x): x is string => !!x) }
  }
  if (tool === "helm") {
    if (!HELM_CHANGES.has(plain[0] ?? "")) return undefined
    return { tool, names: [flag(args, "--kube-context"), flag(args, "--namespace", "-n")].filter((x): x is string => !!x) }
  }
  if (tool === "az" || tool === "aws" || tool === "gcloud") {
    if (!plain.slice(1).some((w) => CLOUD_VERB.test(w))) return undefined
    const names =
      tool === "aws"
        ? [flag(args, "--profile"), env.AWS_PROFILE]
        : tool === "az"
          ? [flag(args, "--subscription"), flag(args, "--resource-group", "-g")]
          : [flag(args, "--project"), flag(args, "--configuration"), env.CLOUDSDK_CORE_PROJECT]
    return { tool, names: names.filter((x): x is string => !!x) }
  }
  return undefined
}

export interface ProdContextFinding {
  ruleId: typeof PROD_CONTEXT_RULE
  reason: string
  risk: number
}

/** A cloud change pointed at what looks like production, with the name; undefined when there is none. */
export function productionContext(segments: Segment[]): ProdContextFinding | undefined {
  for (const s of segments) {
    const c = cloudCall(s)
    const prod = c?.names.find(looksProduction)
    if (c && prod)
      return {
        ruleId: PROD_CONTEXT_RULE,
        reason: `This changes things with ${c.tool} in ${prod}, which looks like production, so it is Severe and waits for you.`,
        risk: PROD_CONTEXT_RISK,
      }
  }
  return undefined
}
