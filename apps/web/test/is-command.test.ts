// Owner, 17 Nov: pasted output that starts with a path is a prompt, not an unknown command.
import { describe, expect, it } from "vitest"
import { isCommand } from "../src/lib/isCommand"

describe("what counts as a slash command", () => {
  it("is a slash and a name, with or without what follows", () => {
    for (const t of ["/clear", "/mcp server", "/plugin:skill", "/model opus\nmore", "/compact"]) expect(isCommand(t), t).toBe(true)
  })

  it("is not a path, pasted output, or a lone slash", () => {
    for (const t of ["/dev/mapper/usbdrive-vm--101--disk--0  16G 1.2G\nkellyp@host:~$ ls", "/usr/bin/env", "/ etc", "/", "/1abc", "hello /clear"])
      expect(isCommand(t), t).toBe(false)
  })
})
