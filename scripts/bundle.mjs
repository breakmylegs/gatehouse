// Builds the Host, the Approver and the phone Relay into one JavaScript file each, for the package. Run from source,
// JCVC reads and compiles about 1,500 files every start (and Windows scans each one on the first start after an
// install or update); built, it reads a handful. The TypeScript sources stay in the package as they are.
//
// Usage: node scripts/bundle.mjs <app folder>   writes <app>/apps/{host,approver,relay}/dist/main.mjs
//
// Each built file sits in apps/<name>/dist, at the same depth as apps/<name>/src, so paths the code finds from its
// own place (the rules, the scripts, the web app) still lead to the same files. A few packages stay outside the
// bundle because they find their own files at run time: the Agent SDK (its Claude binary) and the shell parser
// (its .wasm files).
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const app = path.resolve(process.argv[2] ?? "")
if (!process.argv[2]) throw new Error("Usage: node scripts/bundle.mjs <app folder>")

/** Packages loaded from node_modules at run time instead of being built in. */
export const OUTSIDE = [
  "@anthropic-ai/claude-agent-sdk",
  "web-tree-sitter",
  "tree-sitter-bash",
  // pino starts worker threads from files next to its own; fastify loads it.
  "pino",
  "thread-stream",
]

// ESM output that holds CommonJS packages needs require, __filename and __dirname of its own.
const banner = [
  'import { createRequire as __jcvcRequire } from "node:module"',
  'import { fileURLToPath as __jcvcPath } from "node:url"',
  'import { dirname as __jcvcDir } from "node:path"',
  "const require = __jcvcRequire(import.meta.url)",
  "const __filename = __jcvcPath(import.meta.url)",
  "const __dirname = __jcvcDir(__filename)",
].join("\n")

for (const name of ["host", "approver", "relay"]) {
  const out = path.join(app, "apps", name, "dist", "main.mjs")
  await build({
    entryPoints: [path.join(root, "apps", name, "src", "main.ts")],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: OUTSIDE,
    banner: { js: banner },
    legalComments: "none",
    logLevel: "warning",
    // The TypeScript sources import each other with .js extensions; esbuild maps them back to .ts.
    resolveExtensions: [".ts", ".mjs", ".js", ".json"],
  })
  console.log(`[bundle] ${path.relative(app, out)}`)
}
