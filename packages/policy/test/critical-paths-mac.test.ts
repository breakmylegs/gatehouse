// Mac fork, O-MAC-1 (owner, 13 Nov): on a Mac a session never changes macOS's own folders, the Applications folder,
// or what starts by itself at login or in every Terminal; reading them is fine, and Homebrew's folders are yours.
import { describe, expect, it } from "vitest"
import { analyseBash } from "../src/bash.js"
import { MAC_CRITICAL_RULE, macCriticalWrite } from "../src/critical-paths-mac.js"

const mac: { platform: NodeJS.Platform; home: string } = { platform: "darwin", home: "/Users/pat" }
const CWD = "/Users/pat/dev/shop"
const shell = async (command: string, o = mac) =>
  macCriticalWrite({ toolName: "Bash", input: { command } }, (await analyseBash(command)).segments, CWD, o)
const file = (toolName: string, file_path: string) => macCriticalWrite({ toolName, input: { file_path } }, [], CWD, mac)

describe("the Mac's system folders (O-MAC-1)", () => {
  it("refuses a change to macOS's folders and Applications, from a file tool or the shell, through sudo", async () => {
    expect(file("Write", "/Library/LaunchDaemons/x.plist")).toMatchObject({ outcome: "deny", ruleId: MAC_CRITICAL_RULE })
    expect(file("Edit", "/etc/hosts")?.reason).toMatch(/never changed by a session.*\(it changes \/etc\/hosts\)/)
    expect(file("Write", "../../../../System/Library/x")).toMatchObject({ ruleId: MAC_CRITICAL_RULE })
    for (const cmd of [
      "echo 127.0.0.1 x >> /etc/hosts",
      "sudo cp tool /usr/bin/tool",
      "cp -R Codehouse.app /Applications/",
      "rm -rf /Library/Caches/x",
      "sudo mkdir -p /Library/LaunchDaemons",
      "sudo -u root tee /private/etc/sudoers.d/x",
      "sed -i '' s/a/b/ /etc/paths",
      "ln -sf ~/bin/x /usr/sbin/x",
    ])
      expect(await shell(cmd), cmd).toMatchObject({ outcome: "deny", ruleId: MAC_CRITICAL_RULE })
  })

  it("refuses what would start by itself: a launch agent, or a shell's start-up file", async () => {
    expect(file("Write", "/Users/pat/Library/LaunchAgents/com.x.plist")).toMatchObject({ ruleId: MAC_CRITICAL_RULE })
    expect(file("Edit", "/Users/pat/.zshrc")).toMatchObject({ ruleId: MAC_CRITICAL_RULE })
    for (const cmd of ["echo 'export PATH=/tmp:$PATH' >> ~/.zshrc", "cp agent.plist ~/Library/LaunchAgents/", "touch $HOME/.zshenv"])
      expect(await shell(cmd), cmd).toMatchObject({ ruleId: MAC_CRITICAL_RULE })
  })

  it("lets a session read them, change Homebrew's folders and its own, and does nothing away from a Mac", async () => {
    for (const cmd of [
      "cat /etc/hosts",
      "ls /Applications /Library/Developer",
      "/usr/bin/git status",
      "cp /etc/hosts ./hosts.txt",
      "ln -sf ~/.local/powershell/pwsh /opt/homebrew/bin/pwsh",
      "mkdir -p /usr/local/share/x",
      "brew install jq",
      "grep zsh ~/.zshrc > notes.txt",
      "echo x 2>&1 > /dev/null",
    ])
      expect(await shell(cmd), cmd).toBeNull()
    expect(file("Write", "/Users/pat/dev/shop/src/a.ts")).toBeNull()
    expect(file("Write", "/Users/pat/Library/Application Support/x/y.json")).toBeNull()
    expect(await shell("echo x >> /etc/hosts", { ...mac, platform: "win32" })).toBeNull()
  })
})
