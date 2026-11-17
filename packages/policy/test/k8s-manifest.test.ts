// E-023: an edit to a Kubernetes manifest or Helm values that adds a dangerous setting is Severe and names it; one the
// file already had is not found again, latest tags and missing limits are only noted beside, and other YAML is left be.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { K8S_RISK, K8S_RULE, isK8sFile, k8sFindings } from "../src/k8s-manifest.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-k8s-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: web
          image: shop/web:1.4.2
          resources:
            limits:
              cpu: "1"
`

describe("Kubernetes manifests (E-023)", () => {
  it("holds a new privileged container, host access or root as Severe, naming them", () => {
    const file = path.join(dir, "deploy.yaml")
    const r = k8sFindings("Write", { file_path: file, content: DEPLOY.replace("image: shop/web:1.4.2", "image: shop/web:latest\n          securityContext:\n            privileged: true\n            runAsUser: 0") }, file)
    expect(r).toMatchObject({ ruleId: K8S_RULE, risk: K8S_RISK })
    expect(r?.reason).toMatch(/a privileged container, running as root \(runAsUser 0\) \(and an image on the latest tag\)/)
    for (const add of ["      hostNetwork: true", "      hostPID: true", "      volumes:\n        - name: h\n          hostPath:\n            path: /", "            allowPrivilegeEscalation: true"])
      expect(k8sFindings("Write", { file_path: file, content: `${DEPLOY}${add}\n` }, file), add).toMatchObject({ ruleId: K8S_RULE })
  })

  it("holds a Secret written in plain text, and an Edit that adds a setting to a manifest", () => {
    const secret = path.join(dir, "secret.yaml")
    expect(k8sFindings("Write", { file_path: secret, content: "apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\nstringData:\n  password: x\n" }, secret)?.reason).toMatch(/a Secret in plain text/)
    const file = path.join(dir, "edited.yaml")
    fs.writeFileSync(file, DEPLOY)
    expect(k8sFindings("Edit", { file_path: file, old_string: "    spec:\n      containers:", new_string: "    spec:\n      hostNetwork: true\n      containers:" }, file)).toMatchObject({ ruleId: K8S_RULE })
    expect(k8sFindings("MultiEdit", { file_path: file, edits: [{ old_string: "      containers:", new_string: "      hostPID: true\n      containers:" }] }, file)).toMatchObject({ ruleId: K8S_RULE })
  })

  it("does not find again what the file had, holds nothing for a latest tag alone, and leaves other YAML be", () => {
    const file = path.join(dir, "already.yaml")
    const priv = DEPLOY.replace("image: shop/web:1.4.2", "image: shop/web:1.4.2\n          securityContext:\n            privileged: true")
    fs.writeFileSync(file, priv)
    expect(k8sFindings("Write", { file_path: file, content: priv.replace("1.4.2", "1.4.3") }, file)).toBeUndefined()
    expect(k8sFindings("Write", { file_path: path.join(dir, "new.yaml"), content: DEPLOY.replace("1.4.2", "latest") }, undefined)).toBeUndefined()
    const ci = path.join(dir, "ci.yml")
    expect(k8sFindings("Write", { file_path: ci, content: "jobs:\n  build:\n    privileged: true\n" }, ci)).toBeUndefined()
    expect(isK8sFile("charts/web/values.yaml", "replicas: 2")).toBe(true)
    expect(isK8sFile("notes.md", DEPLOY)).toBe(false)
    expect(k8sFindings("Read", { file_path: file }, file)).toBeUndefined()
  })
})
