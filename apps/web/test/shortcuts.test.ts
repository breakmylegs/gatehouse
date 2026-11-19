// T-071: customisable shortcuts. Your keys come first and a default yields to them; a key that decides a request, or
// the kill switch, is never given to anything; a key cannot be used twice; a command not known is left alone, and one
// added later starts with its default.
import { describe, expect, it } from "vitest"
import { commandFor, effective, eventKeys, normalise, SHORTCUTS } from "../src/lib/shortcuts"

const ev = (key: string, o: { ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {}) => ({ key, ctrlKey: !!o.ctrl, metaKey: false, altKey: !!o.alt, shiftKey: !!o.shift, ...(o.code ? { code: o.code } : {}) })

describe("customisable shortcuts (T-071)", () => {
  it("writes keys one way, and refuses what would fire while typing", () => {
    expect(normalise("shift+ctrl+p")).toBe("Ctrl+Shift+P")
    expect(normalise("Cmd+K")).toBe("Ctrl+K")
    expect(normalise("f2")).toBe("F2")
    expect(normalise("b")).toBeUndefined()
    expect(normalise("Shift+B")).toBeUndefined()
    expect(normalise("Ctrl+Hyper+B")).toBeUndefined()
    expect(eventKeys(ev(":", { ctrl: true, shift: true, code: "Semicolon" }))).toBe("Ctrl+Shift+;")
    expect(eventKeys(ev("k", { ctrl: true, code: "KeyK" }))).toBe("Ctrl+K")
  })

  it("puts yours first, lets a default yield to a key you took, and allows none", () => {
    const r = effective({ sidebar: "Ctrl+K", help: "" })
    expect(r.keys.sidebar).toBe("Ctrl+K")
    expect(r.keys.palette).toBeUndefined()
    expect(r.keys.help).toBeUndefined()
    expect(r.keys.shortcuts).toBe("Ctrl+/")
    expect(r.refused).toEqual([])
    expect(commandFor(ev("k", { ctrl: true, code: "KeyK" }), r.keys)).toBe("sidebar")
    expect(commandFor(ev("F1"), r.keys)).toBeUndefined()
  })

  it("never gives away the keys that decide a request or the kill switch, nor one key twice", () => {
    const r = effective({ sidebar: "Ctrl+Enter", palette: "Ctrl+Shift+K", help: "Ctrl+J", "copy-code": "Ctrl+J", shortcuts: "nonsense+" })
    // In the registry's order: the first to ask for Ctrl+J (copy-code) has it; help asked second.
    expect(r.refused.map((x) => x.id)).toEqual(["palette", "shortcuts", "sidebar", "help"])
    expect(r.refused.find((x) => x.id === "help")?.why).toMatch(/already given to another command/)
    expect(r.refused.find((x) => x.id === "sidebar")?.why).toMatch(/never given to anything else/)
    expect(r.keys.sidebar).toBe("Ctrl+B")
    expect(r.keys.palette).toBe("Ctrl+K")
    expect(r.keys["copy-code"]).toBe("Ctrl+J")
    expect(r.keys.help).toBe("F1")
    expect(Object.values(r.keys)).not.toContain("Ctrl+Enter")
    expect(Object.values(r.keys)).not.toContain("Ctrl+Shift+K")
  })

  it("leaves a command it does not know alone, and gives every known one its default when you set nothing", () => {
    const r = effective({ "from-a-newer-version": "Ctrl+Q" })
    expect(r.refused).toEqual([])
    for (const s of SHORTCUTS) expect(r.keys[s.id]).toBe(s.keys)
  })
})
