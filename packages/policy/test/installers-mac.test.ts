// Mac fork. D-096 on a Mac: installing software is the installer-admission rule there too (installers-mac.ts), so it
// is High, says what it installs and from where, and Extreme approval never approves it. Looking installs nothing.
import { describe, expect, it } from "vitest"
import { analyseBash } from "../src/bash.js"
import { INSTALLER_RULE, installerCall } from "../src/installers.js"

const judge = async (cmd: string) => installerCall((await analyseBash(cmd)).segments)

describe("installing software on a Mac", () => {
  it("is the installer rule at High risk, naming the package and where it comes from", async () => {
    const r = await judge("brew install ripgrep")
    expect(r).toMatchObject({ ruleId: INSTALLER_RULE, risk: 80 })
    expect(r?.reason).toMatch(/with brew: ripgrep, from Homebrew/)
    expect((await judge("brew install --cask visual-studio-code"))?.reason).toMatch(/as a cask\): visual-studio-code, from Homebrew's casks/)
    expect((await judge("brew install someone/tools/widget"))?.reason).toMatch(/from the tap someone\/tools/)
    expect((await judge("brew tap someone/tools"))?.reason).toMatch(/brew tap: someone\/tools/)
    expect((await judge("brew upgrade"))?.reason).toMatch(/every outdated package/)
    expect((await judge("brew bundle --file Brewfile"))?.reason).toMatch(/brew bundle: Brewfile/)
  })

  it("covers MacPorts, Apple's installer, softwareupdate and the Mac App Store, through sudo", async () => {
    expect((await judge("sudo port install wget"))?.reason).toMatch(/with port: wget, from MacPorts/)
    expect((await judge("sudo installer -pkg ./Tool.pkg -target /"))?.reason).toMatch(/with installer: \.\/Tool\.pkg, from a package file/)
    expect((await judge("sudo -u admin softwareupdate -i -a"))?.reason).toMatch(/with softwareupdate: every update it finds, from Apple/)
    expect((await judge("mas install 497799835"))?.reason).toMatch(/with mas: 497799835, from the Mac App Store/)
    expect(await judge("/opt/homebrew/bin/brew install jq")).toMatchObject({ ruleId: INSTALLER_RULE })
    expect(await judge("npm test && brew install jq")).toMatchObject({ ruleId: INSTALLER_RULE })
  })

  it("leaves looking alone, and Windows' installers as upstream judges them", async () => {
    for (const cmd of ["brew list", "brew info jq", "brew search ripgrep", "softwareupdate --list", "port installed", "installer -pkginfo -pkg x.pkg -target /", "mas list"])
      expect(await judge(cmd)).toBeUndefined()
    expect((await judge("winget install Microsoft.PowerToys"))?.reason).toMatch(/with winget: Microsoft\.PowerToys/)
  })
})
