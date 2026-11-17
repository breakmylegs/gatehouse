// The CNW image builds from a clean clone: the Dockerfile copies every workspace's package.json (npm ci checks the
// lockfile against all of them) and every file outside the copied folders that the build imports; the stack's own
// image is never pulled from a registry, and setup needs no tracked file edited.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const dockerfile = fs.readFileSync(path.join(root, "docker/cnw/Dockerfile"), "utf8")
const copied = [...dockerfile.matchAll(/^COPY (?!--from)(.+) (\S+)$/gm)].flatMap((m) => m[1]!.split(/\s+/))
const has = (p: string) => copied.some((c) => c === p || p.startsWith(`${c.replace(/\/$/, "")}/`))

describe("the CNW image (Dockerfile)", () => {
  it("copies every workspace's package.json", () => {
    for (const dir of ["apps", "packages"])
      for (const name of fs.readdirSync(path.join(root, dir)))
        if (fs.existsSync(path.join(root, dir, name, "package.json"))) expect(has(`${dir}/${name}/package.json`), `${dir}/${name}`).toBe(true)
  })

  it("copies what the interface's and CNW's builds import from outside their folders", () => {
    // Relative imports in the Vite config and CNW's sources that leave their own app.
    const sources = [path.join(root, "apps/web/vite.config.ts"), ...fs.readdirSync(path.join(root, "apps/cnw/src")).map((f) => path.join(root, "apps/cnw/src", f))]
    for (const file of sources)
      for (const m of fs.readFileSync(file, "utf8").matchAll(/from "(\.\.\/[^"]+)"/g)) {
        const target = path.relative(root, path.resolve(path.dirname(file), m[1]!)).replace(/\\/g, "/")
        expect(has(target), `${path.relative(root, file)} imports ${target}`).toBe(true)
      }
    expect(has("scripts/workspace-aliases.mjs")).toBe(true)
  })
})

describe("the CNW stack (compose)", () => {
  const compose = parse(fs.readFileSync(path.join(root, "docker/cnw/compose.yml"), "utf8")) as { services: Record<string, { image?: string; build?: unknown; pull_policy?: string }> }

  it("never pulls its own image: each service using it builds it or has pull_policy never", () => {
    for (const [name, s] of Object.entries(compose.services))
      if (s.image?.startsWith("codehouse-cnw")) expect(s.build !== undefined || s.pull_policy === "never", name).toBe(true)
    expect(compose.services.updater?.pull_policy).toBe("never")
  })

  it("runs the updater as the clone's owner, with a home git can use, so it can check out a release", () => {
    const u = compose.services.updater as { user?: string; environment?: Record<string, string> }
    expect(u.user).toBe("${CNW_UID:-1000}:${CNW_GID:-1000}")
    expect(u.environment?.HOME).toBe("/tmp")
  })

  it("checks the updater's health on its own port, not cnw's image health check on 8080", () => {
    const test = (compose.services.updater as { healthcheck?: { test?: string[] } }).healthcheck?.test ?? []
    expect(test.join(" ")).toContain("http://127.0.0.1:8090/health")
    expect(test.join(" ")).not.toContain("8080")
  })

  it("has no fixed Caddyfile to edit: caddy's configuration is written from .env", () => {
    expect(fs.existsSync(path.join(root, "docker/cnw/Caddyfile"))).toBe(false)
    expect(JSON.stringify(compose.services.caddy)).toContain("/caddy-config/Caddyfile")
  })
})
