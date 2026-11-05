// Secrets sealed with DPAPI (the phone, Slack and ntfy sign-ins) work without PowerShell 7 too (owner, 4 Nov: no
// version of PowerShell may be a hard dependency), and where PowerShell refuses script files.
import fs from "node:fs"
import { describe, expect, it } from "vitest"
import { DpapiProtector } from "../src/relay/protector.js"

const WINDOWS_POWERSHELL = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe.skipIf(process.platform !== "win32")("DPAPI sealing", () => {
  it.skipIf(!fs.existsSync(WINDOWS_POWERSHELL))(
    "seals and opens in Windows PowerShell, and opens what the other PowerShell sealed",
    async () => {
      const five = new DpapiProtector(undefined, WINDOWS_POWERSHELL)
      const usual = new DpapiProtector()
      const sealed = await five.protect(new TextEncoder().encode("sign-in"))
      expect(text(sealed)).not.toContain("sign-in")
      expect(text(await five.unprotect(sealed))).toBe("sign-in")
      expect(text(await usual.unprotect(sealed))).toBe("sign-in")
      expect(
        text(await five.unprotect(await usual.protect(new TextEncoder().encode("back")))),
      ).toBe("back")
    },
    60_000,
  )

  it("fails, never returns the bytes as they were, when the script is missing", async () => {
    const p = new DpapiProtector("C:\\nowhere\\dpapi.ps1")
    await expect(p.protect(new TextEncoder().encode("x"))).rejects.toThrow(/DPAPI protect failed/)
  })
})
