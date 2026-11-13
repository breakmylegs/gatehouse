// O28: the release's files go up one at a time into a draft, each retried; it is published only when every file on
// GitHub matches the one here; a failure leaves the draft unpublished, and running again carries it on.
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { publishRelease, type Ran } from "../../../scripts/release-upload.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-upload-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const file = (name: string, text: string) => {
  fs.writeFileSync(path.join(dir, name), text)
  return path.join(dir, name)
}
const files = [file("Codehouse-Setup.exe", "x".repeat(5000)), file("update.json", "{}"), file("update.sig", "sig")]
const sha = (f: string) => `sha256:${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`

/** A fake GitHub: a release with assets; `failUploads` uploads of a name fail before one succeeds. */
function github(o: { failUploads?: Record<string, number>; corrupt?: string; existing?: "draft" | "published" } = {}) {
  let release: { isDraft: boolean; assets: Array<{ name: string; size: number; digest: string }> } | undefined = o.existing ? { isDraft: o.existing === "draft", assets: [] } : undefined
  const fails = { ...o.failUploads }
  const calls: string[] = []
  const run = (_cmd: string, args: string[]): Ran => {
    calls.push(args.slice(0, 2).join(" "))
    const ok = (stdout = ""): Ran => ({ status: 0, stdout, stderr: "" })
    if (args[1] === "view") return release ? ok(JSON.stringify(release)) : { status: 1, stdout: "", stderr: "release not found" }
    if (args[1] === "create") {
      release = { isDraft: args.includes("--draft"), assets: [] }
      return ok()
    }
    if (args[1] === "upload") {
      const f = args[3]!
      const name = path.basename(f)
      if ((fails[name] ?? 0) > 0) {
        fails[name]!--
        return { status: 1, stdout: "", stderr: "HTTP 502: connection reset" }
      }
      release!.assets = release!.assets.filter((a) => a.name !== name)
      release!.assets.push({ name, size: name === o.corrupt ? 1 : fs.statSync(f).size, digest: sha(f) })
      return ok()
    }
    if (args[1] === "edit") {
      release!.isDraft = !args.includes("--draft=false")
      return ok()
    }
    return { status: 1, stdout: "", stderr: "unknown" }
  }
  return { run, calls, state: () => release }
}

const base = { repo: "o/r", tag: "v2.0.300", title: "Codehouse 2.0.300", notesFile: "n.md", target: "abc", files, waitMs: 0, log: () => undefined }

describe("publishing a release (O28)", () => {
  it("uploads each file into a draft, retrying a failed one, and publishes when all match", () => {
    const g = github({ failUploads: { "Codehouse-Setup.exe": 2 } })
    publishRelease({ ...base, run: g.run })
    expect(g.state()).toMatchObject({ isDraft: false })
    expect(g.state()!.assets.map((a) => a.name)).toEqual(["Codehouse-Setup.exe", "update.json", "update.sig"])
    expect(g.calls.filter((c) => c === "release upload")).toHaveLength(5)
    expect(g.calls[1]).toBe("release create")
  })

  it("never publishes with a file missing or not matching, and carries the draft on next time", () => {
    const g = github({ failUploads: { "update.sig": 9 } })
    expect(() => publishRelease({ ...base, run: g.run })).toThrow(/update\.sig could not be uploaded after 4 tries\. The release is still a draft/)
    expect(g.state()).toMatchObject({ isDraft: true })
    // Again: the files already up are not sent again, and it is published.
    const again = github({ existing: "draft" })
    publishRelease({ ...base, run: again.run })
    expect(again.state()).toMatchObject({ isDraft: false })
    const corrupt = github({ corrupt: "update.json" })
    expect(() => publishRelease({ ...base, run: corrupt.run })).toThrow(/do not match the ones here: update\.json/)
    expect(corrupt.state()).toMatchObject({ isDraft: true })
  })

  it("changes nothing in a release already published", () => {
    const g = github({ existing: "published" })
    expect(() => publishRelease({ ...base, run: g.run })).toThrow(/already published/)
    expect(g.calls).toEqual(["release view"])
  })
})
