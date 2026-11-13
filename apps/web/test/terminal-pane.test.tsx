// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { terminalShell } from "../src/components/TerminalPane"

describe("the terminal pane's shell", () => {
  it("says zsh on a Mac and PowerShell on Windows, matching what the Host runs", () => {
    const safari =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/140.0"
    expect(terminalShell(safari).name).toBe("zsh")
    expect(terminalShell(edge).name).toBe("PowerShell")
    expect(terminalShell("").name).toBe("PowerShell")
  })
})
