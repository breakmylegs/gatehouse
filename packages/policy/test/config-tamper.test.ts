// D-060, the agent-config tamper floor: what it denies, and the ordinary changes to the same files it leaves alone.
import { describe, expect, it } from "vitest"
import { configTamperFile, TAMPER_RULE } from "../src/config-tamper.js"

const none = () => undefined
const edit = (file_path: string, old_string: string, new_string: string) => ({
  toolName: "Edit",
  input: { file_path, old_string, new_string },
})

describe("the agent-config tamper floor (D-060)", () => {
  it("denies changing what a tool may do, and leaves other settings in the same files alone", () => {
    expect(configTamperFile(edit("C:/p/.vscode/settings.json", "", '"chat.tools.autoApprove": true'), "C:/p", none)).toMatchObject({ ruleId: TAMPER_RULE })
    expect(configTamperFile(edit("C:/p/.vscode/settings.json", '"editor.tabSize": 2', '"editor.tabSize": 4'), "C:/p", none)).toBeNull()
    expect(configTamperFile(edit("C:/p/.claude/settings.json", '"env": {}', '"env": { "A": "1" }'), "C:/p", none)).toBeNull()
    expect(configTamperFile(edit("C:/p/.claude/settings.json", "", '"hooks": {}'), "C:/p", none)).toMatchObject({ outcome: "deny" })
    // A Write that leaves permissions and hooks as they were is not tampering.
    const same = { toolName: "Write", input: { file_path: "C:/p/.claude/settings.json", content: '{"permissions":{"allow":[]},"env":{"B":"2"}}' } }
    expect(configTamperFile(same, "C:/p", () => '{"permissions":{"allow":[]},"env":{}}')).toBeNull()
    // One that cannot be read as JSON cannot be shown to.
    const broken = { toolName: "Write", input: { file_path: "C:/p/.claude/settings.json", content: "{ not json" } }
    expect(configTamperFile(broken, "C:/p", () => "{}")).toMatchObject({ outcome: "deny" })
  })

  it("guards Codehouse's own data folder exactly, not a project named like it", () => {
    expect(configTamperFile(edit("C:/Users/x/AppData/Local/Gatehouse/config.json", "a", "b"), "C:/p", none)).toMatchObject({ outcome: "deny" })
    expect(configTamperFile(edit("C:/dev/gatehouse/apps/host/src/a.ts", "a", "b"), "C:/dev/gatehouse", none)).toBeNull()
  })
})
