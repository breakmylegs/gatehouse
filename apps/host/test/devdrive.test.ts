// E-027: Doctor shows each project's volume type and Defender's performance mode where it can be read, else not known,
// and never asks for administrator rights.
import os from "node:os"
import { describe, expect, it } from "vitest"
import { devDriveCheck, devDriveQuery, drivesOf, readDevDrive } from "../src/devdrive.js"

describe("Dev Drive and Defender awareness", () => {
  it("shows each project's volume type and Defender's mode", () => {
    const facts = {
      volumes: [
        { drive: "C:", fileSystem: "NTFS", devDrive: false },
        { drive: "D:", fileSystem: "ReFS", devDrive: true },
        { drive: "E:", fileSystem: "ReFS" },
      ],
      defenderPerformance: "on" as const,
    }
    const check = devDriveCheck(facts, [
      { name: "shop", folder: "C:\\dev\\shop" },
      { name: "api", folder: "D:\\src\\api" },
      { name: "lab", folder: "E:\\lab" },
    ])
    expect(check.detail).toBe("shop on C: (NTFS), api on D: (Dev Drive), lab on E: (ReFS (Dev Drive not known)). Defender's performance mode for Dev Drives: on.")
    expect(devDriveCheck(undefined, []).detail).toBe("Not known on this computer.")
    expect(devDriveCheck({ volumes: [{ drive: "C:", fileSystem: "NTFS", devDrive: false }], defenderPerformance: "not known" }, [{ name: "shop", folder: "C:\\dev\\shop" }]).fix).toMatch(/Dev Drive/)
  })

  it("asks Windows nothing that needs an administrator, and puts only drive letters in its query", () => {
    const q = devDriveQuery(drivesOf(["C:\\dev\\a", "c:\\dev\\b", "D:\\x'; Remove-Item C:\\ -Recurse; '"]))
    expect(q).not.toMatch(/RunAs|Start-Process|-Verb|Set-MpPreference|sudo/i)
    expect(q).toContain("@('C:','D:')")
    expect(q).not.toContain("Remove-Item")
    // Even given more than a drive letter, the query keeps only letters and the colon.
    expect(devDriveQuery(["C:';Remove-Item x;'"])).not.toContain("Remove-Item")
  })

  it.skipIf(process.platform !== "win32")("reads this computer's volume without prompting", { timeout: 30_000 }, async () => {
    const f = await readDevDrive([os.tmpdir()])
    expect(f?.volumes[0]?.fileSystem).toMatch(/^(NTFS|ReFS|FAT32|exFAT|not known)$/)
    expect(["on", "off", "not known"]).toContain(f?.defenderPerformance)
  })
})
