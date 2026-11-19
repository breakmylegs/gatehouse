// T-118 (in part): the emulators and simulators running here are listed from adb and simctl, and a picture of one is
// taken only for a plain device id and kept only when it is a PNG.
import { describe, expect, it } from "vitest"
import { listDevices, parseAdb, parseSimctl, screenshot, type Run } from "../src/devices-panel.js"

const ADB = "List of devices attached\nemulator-5554          device product:sdk_gphone64 model:sdk_gphone64_x86_64 device:emu64x\nR58M12345              unauthorized usb:1-1\nbad;id                 device\n\n"
const SIMCTL = JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [{ udid: "1A2B-3C4D", name: "iPhone 16", state: "Booted" }, { udid: "9Z", name: "iPad", state: "Shutdown" }] } })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("rest")])

describe("a device beside the session (T-118)", () => {
  it("lists the running emulators and booted simulators, and nothing unauthorised, stopped or oddly named", () => {
    expect(parseAdb(ADB)).toEqual([{ kind: "android", id: "emulator-5554", name: "sdk gphone64 x86 64" }])
    expect(parseSimctl(SIMCTL)).toEqual([{ kind: "ios", id: "1A2B-3C4D", name: "iPhone 16" }])
    expect(parseSimctl("not json")).toEqual([])
  })

  it("asks simctl only on a Mac, and lists none when the tools are not there", async () => {
    const asked: string[] = []
    const exec: Run = async (cmd) => {
      asked.push(cmd)
      if (cmd === "adb") throw new Error("ENOENT")
      return Buffer.from(SIMCTL)
    }
    expect(await listDevices("win32", exec)).toEqual([])
    expect(asked).toEqual(["adb"])
    expect((await listDevices("darwin", exec)).map((d) => d.id)).toEqual(["1A2B-3C4D"])
  })

  it("takes a picture only of a plain device id, and keeps it only when it is a PNG", async () => {
    const calls: string[][] = []
    const exec: Run = async (cmd, args) => {
      calls.push([cmd, ...args])
      return args.includes("bad") ? Buffer.from("error: no device") : PNG
    }
    expect(await screenshot({ kind: "android", id: "emulator-5554" }, exec)).toEqual(PNG)
    expect(calls[0]).toEqual(["adb", "-s", "emulator-5554", "exec-out", "screencap", "-p"])
    expect(await screenshot({ kind: "ios", id: "1A2B-3C4D" }, exec)).toEqual(PNG)
    expect(await screenshot({ kind: "android", id: "bad" }, exec)).toBeUndefined()
    expect(await screenshot({ kind: "android", id: "x; rm -rf /" }, exec)).toBeUndefined()
    expect(calls).toHaveLength(3)
  })
})
