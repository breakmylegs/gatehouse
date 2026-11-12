// C-031, code outline and navigation: each language's symbols with their lines, nested as in the file, and a
// 5,000-line file outlined in under 50 ms once its grammar is loaded.
import { describe, expect, it } from "vitest"
import { flatten, jsonOutline, languageOf, outline } from "../src/outline.js"

const names = (s: Awaited<ReturnType<typeof outline>>) => flatten(s).map((x) => `${x.kind} ${x.path} ${x.line}`)

describe("the outline (C-031)", () => {
  it("knows the languages by extension", () => {
    expect(["a.ts", "a.tsx", "a.mjs", "a.py", "A.cs", "a.ps1", "a.json", "a.md"].map(languageOf)).toEqual([
      "typescript",
      "tsx",
      "javascript",
      "python",
      "c_sharp",
      "powershell",
      "json",
      undefined,
    ])
  })

  it("reads TypeScript and JavaScript, test cases too", async () => {
    const ts = [
      "export interface Shape { area(): number }",
      "export class Circle implements Shape {",
      "  area() {",
      "    return 1",
      "  }",
      "}",
      "export const make = () => new Circle()",
      "const LIMIT = 3",
      'describe("circles", () => {',
      '  it("has an area", () => {})',
      "})",
    ].join("\n")
    expect(names(await outline(ts, "typescript"))).toEqual([
      "interface Shape 1",
      "class Circle 2",
      "method Circle > area 3",
      "variable make 7",
      "test describe circles 9",
      "test describe circles > it has an area 10",
    ])
    const js = "function go() {}\nclass A { run() {} }\n"
    expect(names(await outline(js, "javascript"))).toEqual(["function go 1", "class A 2", "method A > run 2"])
  })

  it("reads Python, C# and PowerShell", async () => {
    expect(names(await outline("class Repo:\n    def get(self):\n        pass\n\ndef main():\n    pass\n", "python"))).toEqual([
      "class Repo 1",
      "function Repo > get 2",
      "function main 5",
    ])
    const cs = "namespace Shop {\n  public class Cart {\n    public int Count { get; set; }\n    public void Add() {}\n  }\n}\n"
    expect(names(await outline(cs, "c_sharp"))).toEqual([
      "namespace Shop 1",
      "class Shop > Cart 2",
      "property Shop > Cart > Count 3",
      "method Shop > Cart > Add 4",
    ])
    expect(names(await outline("function Get-Thing {\n  param($x)\n}\n", "powershell"))).toEqual(["function Get-Thing 1"])
  })

  it("reads a JSON file's keys two levels down, with their lines", () => {
    const json = '{\n  "name": "app",\n  "scripts": {\n    "test": "vitest",\n    "deep": { "x": 1 }\n  },\n  "list": [1, 2]\n}\n'
    expect(names(jsonOutline(json))).toEqual(["key name 2", "key scripts 3", "key scripts > test 4", "key scripts > deep 5", "key list 7"])
    expect(jsonOutline(json).find((k) => k.name === "scripts")?.endLine).toBe(6)
  })

  it("outlines 5,000 lines in under 50 ms once the grammar is loaded", async () => {
    const lines: string[] = []
    for (let i = 0; i < 1000; i++) lines.push(`export function f${i}(a: number): number {`, `  const b = a * ${i}`, "  if (b > 3) return b", "  return a", "}")
    const text = lines.join("\n")
    await outline("const warm = 1", "typescript")
    const times: number[] = []
    let count = 0
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      count = (await outline(text, "typescript")).length
      times.push(performance.now() - t)
    }
    expect(count).toBe(1000)
    // The best of five, so a busy laptop's pauses do not count against the parser.
    expect(Math.min(...times)).toBeLessThan(50)
  })
})
