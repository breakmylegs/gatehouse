// D-097: Doctor shows PowerShell's language mode and hints of AppLocker or WDAC; a failing command that carries a
// lockdown's signature is explained.
import { describe, expect, it } from "vitest"
import { powerShellExe } from "@gatehouse/policy"
import { lockdownCheck, lockdownHint, readLockdown } from "../src/lockdown.js"

describe("Constrained Language Mode awareness", () => {
  it("shows the language mode, warning with the hints when PowerShell is locked down", () => {
    expect(lockdownCheck({ languageMode: "FullLanguage" })).toMatchObject({ state: "ok", detail: "FullLanguage." })
    const locked = lockdownCheck({ languageMode: "ConstrainedLanguage", umci: 2, appLockerRules: 14, lockdownEnv: "0x80000007" })
    expect(locked.state).toBe("warn")
    expect(locked.detail).toBe(
      "ConstrainedLanguage; Windows Defender Application Control enforces code integrity for programs and scripts; AppLocker has 14 rule(s) in effect; __PSLockdownPolicy is set (0x80000007).",
    )
    expect(locked.fix).toMatch(/locked down here/)
    expect(lockdownCheck(undefined).state).toBe("warn")
  })

  it("explains a failure with a lockdown's signature, and leaves others alone", () => {
    expect(lockdownHint("PowerShell", "Cannot invoke method. Method invocation is supported only on core types in this language mode.")).toMatch(/Constrained Language Mode/)
    expect(lockdownHint("Bash", "This program is blocked by group policy. For more information, contact your system administrator.")).toMatch(/AppLocker/)
    expect(lockdownHint("PowerShell", "Your organization used Device Guard to block this app. Application Control policy has blocked this file.")).toMatch(/Application Control/)
    expect(lockdownHint("PowerShell", "File C:\\x.ps1 cannot be loaded because running scripts is disabled on this system.")).toMatch(/execution policy/)
    expect(lockdownHint("PowerShell", "Get-Item : Cannot find path 'C:\\nope' because it does not exist.")).toBeUndefined()
    expect(lockdownHint("Read", "blocked by group policy")).toBeUndefined()
  })

  it.skipIf(process.platform !== "win32")("reads this computer's language mode without administrator rights", { timeout: 30_000 }, async () => {
    const f = await readLockdown(powerShellExe())
    expect(f?.languageMode).toMatch(/^(FullLanguage|ConstrainedLanguage|RestrictedLanguage|NoLanguage)$/)
  })
})
