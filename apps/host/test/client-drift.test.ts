// E-036: the client is generated again with the project's tool in a scratch folder and compared with the committed one;
// a spec change with no regenerated client reports drift, and the scratch folder is gone afterwards.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { checkDrift, findGenerators, hasDrift, type RunAction } from "../src/client-drift.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** A project with an orval config, a spec, and a client generated from a spec. */
function project(spec: string, clientFrom: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-drift-"))
  dirs.push(root)
  fs.writeFileSync(path.join(root, "orval.config.ts"), "export default { shop: { input: './openapi.yaml', output: { target: './src/api/client.ts' } } }\n")
  fs.writeFileSync(path.join(root, "openapi.yaml"), spec)
  fs.mkdirSync(path.join(root, "src", "api"), { recursive: true })
  fs.writeFileSync(path.join(root, "src", "api", "client.ts"), generate(clientFrom))
  return root
}
/** What the stand-in generator writes: one function per path in the spec. */
const generate = (spec: string) => [...spec.matchAll(/^ {2}(\/[\w/{}]+):/gm)].map((m) => `export const call${m[1]!.replace(/\W/g, "_")} = () => fetch("${m[1]}")\n`).join("")

/** A stand-in for orval, run in the scratch folder: it reads the copied spec and writes the client. */
const fakeOrval = (seen: Array<{ command: string; cwd: string }>): RunAction => async (command, cwd) => {
  seen.push({ command, cwd })
  fs.mkdirSync(path.join(cwd, "src", "api"), { recursive: true })
  fs.writeFileSync(path.join(cwd, "src", "api", "client.ts"), generate(fs.readFileSync(path.join(cwd, "openapi.yaml"), "utf8")))
  return { ran: true, exitCode: 0, output: "" }
}

const V1 = "openapi: 3.0.3\npaths:\n  /users:\n    get: {}\n"
const V2 = "openapi: 3.0.3\npaths:\n  /users:\n    get: {}\n  /orders:\n    get: {}\n"

describe("generated client drift", () => {
  it("reports drift when the spec changed and the client was not generated again", async () => {
    const root = project(V2, V1)
    const [g] = findGenerators(["orval.config.ts", "openapi.yaml"], (p) => fs.readFileSync(path.join(root, p), "utf8"))
    expect(g).toEqual({ tool: "orval", config: "orval.config.ts", spec: "openapi.yaml", output: "src/api", command: "npx --no-install orval --config orval.config.ts" })
    const seen: Array<{ command: string; cwd: string }> = []
    const r = await checkDrift(root, g!, fakeOrval(seen))
    expect(r.drift).toEqual({ added: [], gone: [], changed: ["client.ts"] })
    expect(hasDrift(r.drift)).toBe(true)
    expect(seen[0]!.cwd.startsWith(path.join(root, ".codehouse"))).toBe(true)
    expect(fs.readdirSync(path.join(root, ".codehouse"))).toEqual([])
  })

  it("reports no drift when the client matches its spec", async () => {
    const root = project(V2, V2)
    const [g] = findGenerators(["orval.config.ts"], (p) => fs.readFileSync(path.join(root, p), "utf8"))
    expect(hasDrift((await checkDrift(root, g!, fakeOrval([]))).drift)).toBe(false)
  })

  it("says why it could not check, and still leaves no scratch folder", async () => {
    const root = project(V2, V1)
    const [g] = findGenerators(["orval.config.ts"], (p) => fs.readFileSync(path.join(root, p), "utf8"))
    expect(await checkDrift(root, g!, async () => ({ ran: false, exitCode: null, output: "", refused: "the rules denied it" }))).toMatchObject({ notChecked: /not run: the rules denied it/ })
    expect(await checkDrift(root, g!, async () => ({ ran: true, exitCode: 1, output: "orval: not found\n", }))).toMatchObject({ notChecked: expect.stringMatching(/failed \(exit 1\): orval: not found/) })
    expect(fs.readdirSync(path.join(root, ".codehouse"))).toEqual([])
  })

  it("finds openapi-generator, NSwag and Kiota configs, and refuses paths outside the project", () => {
    const files: Record<string, string> = {
      "openapitools.json": JSON.stringify({ "generator-cli": { generators: { ts: { generatorName: "typescript-fetch", output: "#{cwd}/gen/ts", inputSpec: "#{cwd}/api.yaml" }, bad: { output: "../elsewhere" } } } }),
      "Api/client.nswag": JSON.stringify({ documentGenerator: { fromDocument: { url: "../openapi.json" } }, codeGenerators: { openApiToCSharpClient: { output: "Generated/Client.cs" } } }),
      "src/client/kiota-lock.json": JSON.stringify({ descriptionLocation: "../../openapi.yaml", language: "CSharp" }),
    }
    expect(findGenerators(Object.keys(files), (p) => files[p]).map((g) => [g.tool, g.output, g.spec ?? "", g.command])).toEqual([
      ["openapi-generator", "gen/ts", "api.yaml", "npx --no-install openapi-generator-cli generate"],
      ["nswag", "Api/Generated", "openapi.json", "dotnet nswag run client.nswag"],
      ["kiota", "src/client", "openapi.yaml", 'kiota update --output "src/client"'],
    ])
  })
})
