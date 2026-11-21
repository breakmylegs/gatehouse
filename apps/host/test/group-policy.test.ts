// D-095: Group Policy can only make Codehouse stricter: a registry value tightens a decision and shows in Doctor; one
// that tries to allow is ignored, with a Doctor finding.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { loadPolicy, parseRegQuery, PolicyEngine, registryOverlay } from "@gatehouse/policy"
import { AutonomyStore } from "../src/autonomy.js"
import { groupPolicyCheck, readGroupPolicy } from "../src/group-policy.js"

const REG = [
  "",
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Codehouse",
  "    DenyCommands    REG_MULTI_SZ    terraform destroy*\\0kubectl delete*",
  "    AskCommands    REG_MULTI_SZ    git status*",
  "    RemoveAllow    REG_MULTI_SZ    read-workspace",
  "    MaxAutonomy    REG_SZ    acceptEdits",
  "    AllowCommands    REG_MULTI_SZ    rm -rf *",
  "    Telemetry    REG_DWORD    0x1",
  "",
].join("\r\n")
const RULES = path.resolve(import.meta.dirname, "../../../policy/rules.yaml")

describe("Group Policy", () => {
  it("reads the values, stricter only, and ignores what tries to allow or is not known", () => {
    const o = registryOverlay(parseRegQuery(REG))
    expect(o.deny.map((r) => r.commands)).toEqual([["terraform destroy*"], ["kubectl delete*"]])
    expect(o.escalate.map((r) => r.id)).toEqual(["gpo-escalate-1"])
    expect(o.removeAllow).toEqual(["read-workspace"])
    expect(o.cap).toBe("acceptEdits")
    expect(o.ignored).toEqual([
      "AllowCommands: Group Policy can only make Codehouse stricter, so a value that allows is ignored",
      "Telemetry: not a setting Codehouse knows",
    ])
  })

  it("tightens decisions: a denied command, an asked one, and a removed allow", async () => {
    const plain = new PolicyEngine({ getPolicy: () => loadPolicy({ rulesPath: RULES, workspaceRootsOverride: [os.tmpdir()] }) })
    const gpo = registryOverlay(parseRegQuery(REG))
    const strict = new PolicyEngine({ getPolicy: () => loadPolicy({ rulesPath: RULES, workspaceRootsOverride: [os.tmpdir()], registryOverlay: gpo }) })
    const ctx = { cwd: os.tmpdir() }
    const bash = (command: string) => ({ toolName: "Bash", input: { command } })
    expect((await plain.evaluate(bash("git status"), ctx)).outcome).toBe("allow")
    expect(await strict.evaluate(bash("git status"), ctx)).toMatchObject({ outcome: "escalate", ruleId: "gpo-escalate-1" })
    expect(await strict.evaluate(bash("terraform destroy -auto-approve"), ctx)).toMatchObject({ outcome: "deny", ruleId: "gpo-deny-1" })
    const read = { toolName: "Read", input: { file_path: path.join(os.tmpdir(), "notes.txt") } }
    expect((await plain.evaluate(read, ctx)).outcome).toBe("allow")
    expect((await strict.evaluate(read, ctx)).outcome).not.toBe("allow")
  })

  it("caps every project's autonomy at Group Policy's level", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-gpo-"))
    try {
      const store = new AutonomyStore(path.join(dir, "a.json"), () => "acceptEdits")
      expect(store.capFor("shop")).toBe("acceptEdits")
      const none = new AutonomyStore(path.join(dir, "a.json"))
      expect(none.capFor("shop")).toBe("extreme")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("is read from the registry on Windows only, and shown in Doctor, warning about what it ignored", () => {
    expect(readGroupPolicy("darwin", () => REG)).toBeUndefined()
    expect(readGroupPolicy("win32", () => {
      throw new Error("ERROR: The system was unable to find the specified registry key or value.")
    })).toBeUndefined()
    const o = readGroupPolicy("win32", () => REG)!
    const check = groupPolicyCheck(o)
    expect(check).toMatchObject({ id: "group-policy", state: "warn" })
    expect(check.detail).toMatch(/^Applied: 2 command\(s\) refused, 1 command\(s\) asked about, 1 allow rule\(s\) removed, sessions no higher than Accept edits\. Ignored: AllowCommands/)
    expect(groupPolicyCheck(undefined)).toMatchObject({ state: "ok", detail: "None set for Codehouse on this computer." })
  })

  it("has templates that write exactly the values Codehouse reads", () => {
    const admx = fs.readFileSync(path.resolve(import.meta.dirname, "../../../packaging/policy-templates/Codehouse.admx"), "utf8")
    expect([...admx.matchAll(/valueName="(\w+)"/g)].map((m) => m[1])).toEqual(["DenyCommands", "AskCommands", "RemoveAllow", "MaxAutonomy"])
    expect([...admx.matchAll(/key="([^"]+)"/g)].every((m) => m[1] === "Software\\Policies\\Codehouse")).toBe(true)
    const adml = fs.readFileSync(path.resolve(import.meta.dirname, "../../../packaging/policy-templates/en-US/Codehouse.adml"), "utf8")
    for (const id of [...admx.matchAll(/\$\(string\.(\w+)\)/g)].map((m) => m[1])) expect(adml).toContain(`<string id="${id}">`)
  })
})
