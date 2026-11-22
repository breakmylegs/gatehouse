// D-098: with an NPU model on Foundry Local (downloaded and listed), the claims judge runs on it; otherwise it falls
// back to the chosen model and says so.
import { describe, expect, it, vi } from "vitest"
import { judgeModel } from "../src/claim-judge-run.js"
import { foundryNpuModels } from "../src/providers/foundry-local.js"
import type { LocalRuntimeConfig } from "../src/providers/local-runtime.js"

const URL_ = "http://127.0.0.1:61234"
const foundry = (catalogue: unknown[], downloaded: string[]) =>
  vi.fn(async (u: string) => {
    if (u === `${URL_}/foundry/list`) return Response.json({ models: catalogue })
    if (u === `${URL_}/openai/models`) return Response.json(downloaded)
    return new Response("", { status: 404 })
  })
const cfg: LocalRuntimeConfig = {
  kind: "openai-compatible",
  profile: "foundry-local",
  url: URL_,
  models: [{ name: "phi-4-mini-instruct-generic-cpu" }, { name: "phi-silica-npu" }],
}
const catalogue = [
  { name: "phi-4-mini-instruct-generic-cpu", runtime: { deviceType: "CPU" } },
  { name: "phi-silica-npu", runtime: { deviceType: "NPU", executionProvider: "QNNExecutionProvider" } },
  { name: "other-npu", runtime: { deviceType: "npu" } },
]

describe("the NPU judge profile", () => {
  it("finds the downloaded models that run on the NPU", async () => {
    expect(await foundryNpuModels(URL_, foundry(catalogue, ["phi-silica-npu", "phi-4-mini-instruct-generic-cpu"]) as never)).toEqual(["phi-silica-npu"])
    expect(await foundryNpuModels(URL_, (async () => new Response("", { status: 500 })) as never)).toEqual([])
  })

  it("judges on an NPU model that is downloaded and listed, and says so", async () => {
    expect(await judgeModel(cfg, "phi-4-mini-instruct-generic-cpu", foundry(catalogue, ["phi-silica-npu", "other-npu"]) as never)).toEqual({
      model: "phi-silica-npu",
      ranOn: "the NPU, with phi-silica-npu",
    })
  })

  it("falls back to the chosen model when no listed NPU model is downloaded, and says so", async () => {
    expect(await judgeModel(cfg, "phi-4-mini-instruct-generic-cpu", foundry(catalogue, ["other-npu"]) as never)).toEqual({
      model: "phi-4-mini-instruct-generic-cpu",
      ranOn: "no model on your list runs on the NPU in Foundry Local, so phi-4-mini-instruct-generic-cpu judged it",
    })
  })

  it("leaves other runtimes and a judge turned off as they were", async () => {
    const f = foundry(catalogue, ["phi-silica-npu"])
    expect(await judgeModel({ ...cfg, profile: undefined }, "phi-4-mini-instruct-generic-cpu", f as never)).toEqual({ model: "phi-4-mini-instruct-generic-cpu" })
    expect(await judgeModel(cfg, undefined, f as never)).toEqual({})
  })
})
