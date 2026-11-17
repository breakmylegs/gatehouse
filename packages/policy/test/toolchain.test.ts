// E-030: a change to the tools every project on this computer uses waits for you, naming it;
// a project's own install and looking are left to the rules.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { analyseBash } from "../src/bash.js"
import { TOOLCHAIN_RISK, TOOLCHAIN_RULE, toolchainChange } from "../src/toolchain.js"

const plain = fs.mkdtempSync(path.join(os.tmpdir(), "gh-tool-plain-"))
afterAll(() => fs.rmSync(plain, { recursive: true, force: true }))
const judge = async (cmd: string, cwd = plain) => toolchainChange((await analyseBash(cmd)).segments, cwd)

describe("toolchain changes (E-030)", () => {
  it("holds a change for every project, naming it, at High", async () => {
    for (const cmd of [
      "nvm install 22",
      "nvm use 20",
      "fnm default 22",
      "rustup default nightly",
      "pyenv global 3.12.1",
      "npm install -g typescript",
      "pnpm add --global turbo",
      "yarn global add serve",
      "dotnet tool install --global dotnet-ef",
      "./dotnet-install.sh --channel 9.0",
    ])
      expect(await judge(cmd), cmd).toMatchObject({ ruleId: TOOLCHAIN_RULE, risk: TOOLCHAIN_RISK })
    expect((await judge("npm install -g typescript"))?.reason).toContain("npm install -g typescript for every project")
  })

  it("leaves a project's own installs and looking to the rules", async () => {
    for (const cmd of ["npm install lodash", "nvm ls", "rustup show", "pyenv versions", "dotnet tool install dotnet-ef", "pip install -r requirements.txt"])
      expect(await judge(cmd), cmd).toBeUndefined()
    // pip install and Set-ExecutionPolicy are held by their own rules (dependencies, pwsh-execution-policy).
    expect(await judge("pip install requests")).toBeUndefined()
  })
})
