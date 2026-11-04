// B19: what this computer can run, and a model's licence before you use it.
import { describe, expect, it, vi } from "vitest"
import { modelLicence } from "../src/providers/local-runtime.js"
import { forgetProfile, machineProfile, profileOf } from "../src/providers/profile.js"

describe("this computer's profile", () => {
  it("suggests a model size from its memory and graphics card", () => {
    expect(profileOf({ memoryGb: 8 }).size).toBe("small")
    expect(profileOf({ memoryGb: 16 }).size).toBe("medium")
    expect(profileOf({ memoryGb: 32 }).size).toBe("medium")
    expect(
      profileOf({ memoryGb: 32, gpu: { name: "RTX", memoryGb: 8, atLeast: false } }).size,
    ).toBe("large")
    expect(profileOf({ memoryGb: 64 }).size).toBe("large")
    expect(profileOf({ memoryGb: 8 }).advice).toMatch(/up to about 3 billion/)
  })

  it("reads the card with the most memory, once, and says when Windows only reports at least 4 GB", async () => {
    forgetProfile()
    const gpus = vi.fn(async () => [
      { name: "Intel UHD", bytes: 1024 ** 3 },
      { name: "NVIDIA RTX A2000", bytes: 4 * 1024 ** 3 - 1 },
    ])
    const p = await machineProfile(gpus)
    expect(p.gpu).toEqual({ name: "NVIDIA RTX A2000", memoryGb: 4, atLeast: true })
    await machineProfile(gpus)
    expect(gpus).toHaveBeenCalledTimes(1)
    forgetProfile()
  })
})

describe("a model's licence", () => {
  const cfg = {
    kind: "ollama" as const,
    url: "http://127.0.0.1:11434",
    models: [{ name: "tiny" }],
  }
  it("comes from an Ollama runtime on this computer, for a model you allow only", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ license: "MIT License\n..." })))
    expect(await modelLicence(cfg, "tiny", fetchFn as never)).toBe("MIT License\n...")
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/show",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "tiny" }) }),
    )
    expect(await modelLicence(cfg, "other", fetchFn as never)).toBeUndefined()
    expect(
      await modelLicence({ ...cfg, url: "http://10.0.0.5:11434" }, "tiny", fetchFn as never),
    ).toBeUndefined()
    expect(
      await modelLicence({ ...cfg, kind: "openai-compatible" }, "tiny", fetchFn as never),
    ).toBeUndefined()
    const none = vi.fn(async () => new Response(JSON.stringify({})))
    expect(await modelLicence(cfg, "tiny", none as never)).toBeUndefined()
  })
})
