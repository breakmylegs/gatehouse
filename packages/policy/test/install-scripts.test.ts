// D-064, install-script default deny: the install scripts an install would run, read offline, and the command that
// runs it without them.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { installScripts, installScriptsFinding, withoutScripts } from "../src/install-scripts.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-iscripts-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const put = (rel: string, j: unknown) => {
  const f = path.join(dir, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(j))
}
put("package.json", { name: "app", scripts: { test: "vitest", prepare: "husky" } })
put("package-lock.json", {
  packages: {
    "": {},
    "node_modules/esbuild": { hasInstallScript: true },
    "node_modules/lodash": {},
    "node_modules/@acme/native": { hasInstallScript: true },
  },
})
put("node_modules/esbuild/package.json", { scripts: { postinstall: "node install.js" } })
// Not a download piped to a shell: this laptop's antivirus will not let a file holding one be read back.
put("node_modules/evil/package.json", { scripts: { preinstall: "node collect-tokens.js" } })
put("node_modules/lodash/package.json", { scripts: { test: "mocha" } })

describe("install-script default deny (D-064)", () => {
  it("names each script an install would run, with its text", () => {
    expect(installScripts("npm install evil", dir)).toEqual([{ package: "evil", script: "preinstall", text: "node collect-tokens.js" }])
    expect(installScripts("npm install lodash", dir)).toEqual([])
    // A bare install: the project's own prepare, and every package the lockfile says has a script.
    expect(installScripts("npm ci", dir)).toEqual([
      { package: "this project", script: "prepare", text: "husky" },
      { package: "esbuild", script: "postinstall", text: "node install.js" },
      { package: "@acme/native", script: "install" },
    ])
    expect(installScripts("yarn", dir).length).toBe(3)
    // Not an install, or already without scripts.
    expect(installScripts("npm test", dir)).toEqual([])
    expect(installScripts("npm install --ignore-scripts evil", dir)).toEqual([])
    expect(installScriptsFinding("pnpm add evil", dir)?.reason).toContain('evil preinstall: "node collect-tokens.js"')
    // One the lockfile says has a script, not here to read: still asked, and the card says why.
    expect(installScriptsFinding("pnpm add @acme/native", dir)?.reason).toContain("not on this computer")
  })

  it("adds --ignore-scripts to each install only, and leaves the rest of the command as it was", () => {
    expect(withoutScripts("npm install evil")).toBe("npm install --ignore-scripts evil")
    expect(withoutScripts("cd app && npm ci && npm test")).toBe("cd app && npm ci --ignore-scripts && npm test")
    expect(withoutScripts("yarn && yarn test")).toBe("yarn --ignore-scripts && yarn test")
    expect(withoutScripts("yarn add left-pad")).toBe("yarn add --ignore-scripts left-pad")
    expect(withoutScripts("npm install --ignore-scripts x")).toBe("npm install --ignore-scripts x")
  })
})
