// E-021: a change with kubectl, helm, az, aws or gcloud aimed at a context, profile, subscription, project or namespace
// that looks like production is Severe; looking is unchanged, and no kubeconfig or credential file is ever opened.
import fs from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { analyseBash } from "../src/bash.js"
import { PROD_CONTEXT_RISK, PROD_CONTEXT_RULE, productionContext } from "../src/cloud-context.js"

const judge = async (cmd: string) => productionContext((await analyseBash(cmd)).segments)

describe("production contexts for cloud command lines (E-021)", () => {
  it("makes a change in production Severe, naming where", async () => {
    const r = await judge("kubectl apply -f deploy.yaml --context prod-weu")
    expect(r).toMatchObject({ ruleId: PROD_CONTEXT_RULE, risk: PROD_CONTEXT_RISK })
    expect(r?.reason).toContain("prod-weu")
    for (const cmd of [
      "kubectl delete pod web-1 -n production",
      "helm upgrade web ./chart --kube-context live-cluster",
      "aws s3 rm s3://bucket/x --profile prod",
      "AWS_PROFILE=prd aws ec2 terminate-instances --instance-ids i-1",
      "az webapp delete --subscription prod-billing -n web -g rg",
      "gcloud compute instances delete vm-1 --project shop-prod",
    ])
      expect(await judge(cmd), cmd).toMatchObject({ ruleId: PROD_CONTEXT_RULE })
  })

  it("leaves looking, and changes outside production, as the cloud rules judge them", async () => {
    for (const cmd of [
      "kubectl get pods --context prod-weu",
      "kubectl logs web-1 -n production",
      "kubectl apply -f deploy.yaml --context dev-weu",
      "aws s3 ls --profile prod",
      "az account show --subscription prod-billing",
      "helm list --kube-context live",
      "kubectl apply -f deploy.yaml",
    ])
      expect(await judge(cmd), cmd).toBeUndefined()
  })

  it("never opens a kubeconfig or credentials file to find out", async () => {
    const read = vi.spyOn(fs, "readFileSync")
    const open = vi.spyOn(fs, "openSync")
    await judge("kubectl apply -f x.yaml --context prod")
    await judge("aws s3 rm s3://b/x --profile prod")
    const touched = [...read.mock.calls, ...open.mock.calls].map((c) => String(c[0]))
    expect(touched.filter((p) => /kube|\.aws|credentials|gcloud|azure/i.test(p))).toEqual([])
    read.mockRestore()
    open.mockRestore()
  })
})
