// C-067: Foundry Local as a runtime on this computer: found where it listens now, its licence shown, IT's list kept.
import { describe, expect, it, vi } from "vitest"
import { addressesIn, findFoundry, FOUNDRY_DEFAULT_URL } from "../src/providers/foundry-local.js"
import { checkRuntime, modelLicence, type LocalRuntimeConfig } from "../src/providers/local-runtime.js"

/** A fake Foundry Local at one address: its status, the models it has downloaded and its catalogue. */
function foundryAt(url: string, models = ["Phi-4-mini-instruct-generic-cpu"]) {
  return vi.fn(async (u: string) => {
    if (!u.startsWith(url)) throw new Error("nothing there")
    const p = u.slice(url.length)
    if (p === "/openai/status") return Response.json({ Endpoints: [url], ModelDirPath: "x", PipeName: "inference_agent" })
    if (p === "/openai/models") return Response.json(models)
    if (p === "/foundry/list")
      return Response.json({
        models: [
          { name: "Phi-4-mini-instruct-generic-cpu", alias: "phi-4-mini", license: "MIT", licenseDescription: "https://example.test/mit" },
          { name: "unlisted-model", license: "Apache-2.0" },
        ],
      })
    return new Response("", { status: 404 })
  })
}

describe("finding Foundry Local", () => {
  it("takes only addresses on this computer from the command's output", () => {
    expect(
      addressesIn("Model management service is running on http://127.0.0.1:61234/openai/status\nalso http://10.0.0.5:80 and http://localhost:5272"),
    ).toEqual(["http://127.0.0.1:61234", "http://localhost:5272"])
  })

  it("asks the address the command names, running the program file with no shell", async () => {
    const run = vi.fn(async () => "🟢 Model management service is running on http://127.0.0.1:61234/openai/status")
    const fetchFn = foundryAt("http://127.0.0.1:61234")
    const found = await findFoundry({ PATH: "C:\\Foundry", PATHEXT: ".EXE;.CMD" }, run, fetchFn as never, "win32", (p) => p === "C:\\Foundry\\foundry.exe")
    expect(found).toEqual({ url: "http://127.0.0.1:61234", models: ["Phi-4-mini-instruct-generic-cpu"], command: "C:\\Foundry\\foundry.exe" })
    expect(run).toHaveBeenCalledWith("C:\\Foundry\\foundry.exe", ["server", "status"])
    for (const [u, init] of fetchFn.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(u).toMatch(/^http:\/\/127\.0\.0\.1:/)
      expect(init.redirect).toBe("error")
    }
  })

  it("never runs a script of that name, tries the default port, and finds nothing when nothing answers as Foundry Local", async () => {
    const run = vi.fn(async () => "")
    const found = await findFoundry({ PATH: "C:\\bin" }, run, foundryAt(FOUNDRY_DEFAULT_URL) as never, "win32", (p) => p === "C:\\bin\\foundry.cmd")
    expect(run).not.toHaveBeenCalled()
    expect(found?.url).toBe(FOUNDRY_DEFAULT_URL)
    // Another server that answers every path, but not with Foundry Local's status.
    const other = vi.fn(async () => Response.json([]))
    expect(await findFoundry({ PATH: "" }, run, other as never, "win32")).toBeUndefined()
  })
})

describe("a Foundry Local runtime", () => {
  const cfg: LocalRuntimeConfig = {
    kind: "openai-compatible",
    profile: "foundry-local",
    url: "http://127.0.0.1:61234",
    models: [{ name: "Phi-4-mini-instruct-generic-cpu" }, { name: "qwen2.5-7b" }],
  }

  it("shows a listed model's licence from its catalogue, and none for a model you did not list", async () => {
    const fetchFn = foundryAt(cfg.url)
    expect(await modelLicence(cfg, "Phi-4-mini-instruct-generic-cpu", fetchFn as never)).toBe("MIT\n\nhttps://example.test/mit")
    expect(await modelLicence(cfg, "unlisted-model", fetchFn as never)).toBeUndefined()
    expect(await modelLicence({ ...cfg, profile: undefined }, "Phi-4-mini-instruct-generic-cpu", fetchFn as never)).toBeUndefined()
  })

  it("offers only listed models it has downloaded, and only those IT's list allows", async () => {
    const fetchFn = foundryAt(cfg.url)
    expect(await checkRuntime(cfg, fetchFn as never)).toMatchObject({
      ok: true,
      models: ["Phi-4-mini-instruct-generic-cpu"],
      left: [{ name: "qwen2.5-7b", why: "the runtime does not have it" }],
    })
    expect(await checkRuntime(cfg, fetchFn as never, { ok: true, models: ["qwen2.5-7b"] } as never)).toMatchObject({
      ok: false,
      code: "runtime.no-models",
    })
    expect(await checkRuntime(cfg, fetchFn as never, { ok: false, reason: "bad signature" } as never)).toMatchObject({
      ok: false,
      code: "runtime.it-list",
    })
  })

  it("is refused away from this computer, and unreachable when it does not answer as Foundry Local", async () => {
    expect(await checkRuntime({ ...cfg, url: "http://10.0.0.5:61234" }, foundryAt("http://10.0.0.5:61234") as never)).toMatchObject({
      code: "runtime.non-loopback",
    })
    const v1Only = vi.fn(async () => Response.json({ data: [{ id: "Phi-4-mini-instruct-generic-cpu" }] }))
    expect(await checkRuntime(cfg, v1Only as never)).toMatchObject({ ok: false, code: "runtime.unreachable" })
  })
})
