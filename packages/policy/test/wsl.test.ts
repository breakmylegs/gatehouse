// E-028: the Linux command a wsl call runs, and a bash -c from PowerShell, is read for the Bash parser and rules; WSL's
// own management and a bare wsl run none.
import { describe, expect, it } from "vitest"
import { analyseBash } from "../src/bash.js"
import { shellCommand, wslCommand } from "../src/wsl.js"

describe("WSL commands (E-028)", () => {
  it("finds the command after the options, quoting -e's words back and passing the rest to the shell as it is", () => {
    expect(wslCommand(["-e", "bash", "-c", "cat ~/.ssh/id_rsa"])).toBe("bash -c 'cat ~/.ssh/id_rsa'")
    expect(wslCommand(["--exec", "echo", "it's"])).toBe(`echo 'it'\\''s'`)
    expect(wslCommand(["-d", "Ubuntu", "-u", "root", "--", "rm", "-rf", "/"])).toBe("rm -rf /")
    expect(wslCommand(["--cd", "~", "ls; cat .env"])).toBe("ls; cat .env")
    expect(wslCommand(["--system", "ls"])).toBe("ls")
  })

  it("runs nothing for management, a bare wsl or an empty -e", () => {
    for (const args of [[], ["--list", "--verbose"], ["-l"], ["--shutdown"], ["--install", "-d", "Ubuntu"], ["-e"], ["--"]]) expect(wslCommand(args), args.join(" ")).toBeUndefined()
  })

  it("reads bash -c's script, and a quoted -e command parses back to the same words", async () => {
    expect(shellCommand(["-lc", "git status"])).toBe("git status")
    expect(shellCommand(["script.sh"])).toBeUndefined()
    const words = ["printf", "%s\n", "a b", "it's"]
    expect((await analyseBash(wslCommand(["-e", ...words]) ?? "")).segments[0]?.args).toEqual(words.slice(1))
  })
})
