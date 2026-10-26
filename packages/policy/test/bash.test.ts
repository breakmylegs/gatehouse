import { describe, expect, it } from "vitest"
import { analyseBash } from "../src/bash.js"
import { baseCommandName, unwrapVariants, type Segment } from "../src/segments.js"

const texts = async (src: string) => (await analyseBash(src)).segments.map((s) => s.text)

describe("analyseBash segments", () => {
  it("finds every simple command across operators, groups and substitutions", async () => {
    expect(await texts("a && b || c; d | e\nf")).toEqual(["a", "b", "c", "d", "e", "f"])
    expect(await texts("(a; b) && { c; }")).toEqual(["a", "b", "c"])
    expect(await texts("echo $(a $(b)) `c`")).toEqual(expect.arrayContaining(["a $(b)", "b", "c"]))
    expect(await texts("diff <(a) <(b)")).toEqual(expect.arrayContaining(["a", "b"]))
    expect(await texts("f() { a; b; }")).toEqual(["a", "b"])
    expect(await texts("if x; then y; fi")).toEqual(["x", "y"])
    expect(await texts("for i in 1 2; do a; done")).toEqual(["a"])
  })

  it("unquotes words and records the original text of dynamic ones", async () => {
    const a = await analyseBash(`git "st"'at'us "$X" $Y x\\ y`)
    expect(a.segments).toHaveLength(1)
    const s = a.segments[0] as Segment
    expect(s.name).toBe("git")
    expect(s.args).toEqual(["status", '"$X"', "$Y", "x y"])
    expect(s.dynamic).toBe(true)
  })

  it("keeps assignments in the text but not the core text", async () => {
    const s = (await analyseBash("A=1 B='x y' git status")).segments[0] as Segment
    expect(s.text).toBe("A=1 B='x y' git status")
    expect(s.coreText).toBe("git status")
    expect(s.dynamic).toBe(false)
    const d = (await analyseBash("A=$(x) git status")).segments[0] as Segment
    expect(d.dynamic).toBe(true)
  })

  it("marks output redirection but not the null device, fd duplication or input", async () => {
    const writes = async (src: string) => (await analyseBash(src)).segments[0]?.writes
    expect(await writes("a > f")).toBe(true)
    expect(await writes("a >> f")).toBe(true)
    expect(await writes("a &> f")).toBe(true)
    expect(await writes("a 2> f")).toBe(true)
    expect(await writes("a > $f")).toBe(true)
    expect(await writes("a > /dev/null")).toBe(false)
    expect(await writes("a 2>&1")).toBe(false)
    expect(await writes("a 1>&2")).toBe(false)
    expect(await writes("a < f")).toBe(false)
    expect(await writes("(a; b) > f")).toBe(true)
  })

  it("marks the segments that receive a pipe", async () => {
    const segs = (await analyseBash("a | b | c")).segments
    expect(segs.map((s) => Boolean(s.piped))).toEqual([false, true, true])
    const redirected = (await analyseBash("a | b > f")).segments
    expect(redirected.map((s) => Boolean(s.piped))).toEqual([false, true])
  })
})

describe("analyseBash flags", () => {
  it("flags heredocs and eval, static and dynamic", async () => {
    expect((await analyseBash("cat <<EOF\nx\nEOF")).flags.heredoc).toBe(true)
    expect((await analyseBash("eval ls")).flags).toMatchObject({ evalStatic: true, evalDynamic: false })
    expect((await analyseBash('eval "$X"')).flags).toMatchObject({ evalStatic: false, evalDynamic: true })
    expect((await analyseBash("$(echo eval) x")).flags.evalDynamic).toBe(false)
  })

  it("flags pipes into shells, with wrappers, and shells fed by process substitution", async () => {
    for (const src of ["a | sh", "a | /bin/bash -s", "a | sudo bash", "a | env -i dash", "bash <(a)", "source <(a)", ". <(a)"]) {
      expect((await analyseBash(src)).flags.pipeToShell, src).toBe(true)
    }
    for (const src of ["a | grep x", "a | bashful", "sh script.sh", "a; sh"]) {
      expect((await analyseBash(src)).flags.pipeToShell, src).toBe(false)
    }
  })

  it("parses a static bash -c payload and flags a dynamic one", async () => {
    const a = await analyseBash("bash -c 'x; y'")
    expect(a.segments.map((s) => s.text)).toEqual(["bash -c x; y", "x", "y"])
    expect((await analyseBash('sh -c "$X"')).flags.evalDynamic).toBe(true)
    expect((await analyseBash("sh -c")).flags.evalDynamic).toBe(false)
  })

  it("stops following nested bash -c payloads after three levels", async () => {
    const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
    const nest = (n: number): string => (n === 0 ? "rm -rf /" : `bash -c ${quote(nest(n - 1))}`)
    const shallow = await analyseBash(nest(3))
    expect(shallow.segments.some((s) => s.text === "rm -rf /")).toBe(true)
    expect(shallow.flags.evalDynamic).toBe(false)
    const deep = await analyseBash(nest(5))
    expect(deep.flags.evalDynamic).toBe(true)
  })

  it("reports a parse error", async () => {
    expect((await analyseBash("if then fi")).parseError).toBe(true)
    expect((await analyseBash("echo ok")).parseError).toBe(false)
  })

  it("collects words as tokens, including those inside substitutions, with placeholders for expansions", async () => {
    const a = await analyseBash('echo "$HOME/.ssh/x" $(cat .env) \'raw\'')
    const values = a.tokens.map((t) => t.value)
    expect(values).toEqual(expect.arrayContaining(["__dyn__/.ssh/x", ".env", "raw"]))
    expect(a.tokens.find((t) => t.value === "__dyn__/.ssh/x")?.dynamic).toBe(true)
  })

  it("treats an ANSI-C string as one word and does not decode its escapes", async () => {
    const a = await analyseBash("echo $'a\\tb'")
    expect(a.segments[0]?.args).toEqual(["a\\tb"])
  })

  it("survives concurrent use of the shared parser", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => texts(`cmd${i} && other`)))
    results.forEach((r, i) => expect(r).toEqual([`cmd${i}`, "other"]))
  })
})

describe("segments helpers", () => {
  it("baseCommandName strips directories, extensions and case", () => {
    expect(baseCommandName("/usr/bin/Bash")).toBe("bash")
    expect(baseCommandName("C:\\Git\\bin\\SH.EXE")).toBe("sh")
    expect(baseCommandName("pwsh.ps1")).toBe("pwsh")
  })

  it("unwrapVariants removes wrappers, their flags and assignments", () => {
    const seg = (name: string, args: string[]): Segment => ({
      kind: "bash",
      text: [name, ...args].join(" "),
      coreText: [name, ...args].join(" "),
      name,
      args,
      dynamic: false,
      writes: false,
    })
    expect(unwrapVariants(seg("sudo", ["-u", "root", "rm", "-rf", "/"]))).toContain("rm -rf /")
    expect(unwrapVariants(seg("timeout", ["-k", "5", "30", "rm", "-rf", "/"]))).toContain("rm -rf /")
    expect(unwrapVariants(seg("nice", ["-n", "5", "rm", "-rf", "/"]))).toContain("rm -rf /")
    expect(unwrapVariants(seg("env", ["-i", "A=1", "rm", "-rf", "/"]))).toContain("rm -rf /")
    expect(unwrapVariants(seg("nohup", ["time", "rm", "-rf", "/"]))).toContain("rm -rf /")
    expect(unwrapVariants(seg("env", ["-i"]))).toEqual(["env -i"])
    expect(unwrapVariants(seg("git", ["status"]))).toEqual(["git status"])
  })
})
