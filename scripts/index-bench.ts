// C-036's acceptance: 50,000 files indexed in under 3 minutes. Makes that many small source files in a temporary
// folder, indexes them from nothing, then once more (nothing changed), and says how long each took. Deletes it all.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/index-bench.ts [files]
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CodeIndex } from "../apps/host/src/code-index.js"

const n = Number(process.argv[2] ?? 50_000)
const root = fs.mkdtempSync(path.join(os.tmpdir(), "idx-bench-root-"))
const data = fs.mkdtempSync(path.join(os.tmpdir(), "idx-bench-data-"))
const say = (t: string) => console.log(`[index-bench] ${t}`)
try {
  let t = Date.now()
  for (let i = 0; i < n; i++) {
    const dir = path.join(root, `pkg${i % 200}`, `mod${Math.floor(i / 200) % 50}`)
    if (i % 200 < 1 || !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, `file${i}.ts`),
      `// file ${i}\nexport function handler${i}(input: string): string {\n  const value${i} = input.trim()\n  return value${i} + " done"\n}\nexport class Store${i} {\n  items: string[] = []\n}\n`.repeat(4),
    )
  }
  say(`${n} files made in ${((Date.now() - t) / 1000).toFixed(1)} s`)
  const index = new CodeIndex({ dir: data, root, blocked: () => false })
  t = Date.now()
  const first = await index.refresh()
  const firstS = (Date.now() - t) / 1000
  say(`first index: ${first.indexed} files in ${firstS.toFixed(1)} s`)
  t = Date.now()
  const again = await index.refresh()
  say(`again, nothing changed: ${again.indexed} read in ${((Date.now() - t) / 1000).toFixed(1)} s`)
  say(`search "handler4242": ${index.search("handler4242").length} result(s); symbols "Store999": ${index.symbols("Store999").length}`)
  index.close()
  say(firstS < 180 ? "passed: under 3 minutes" : "FAILED: over 3 minutes")
  process.exitCode = firstS < 180 ? 0 : 1
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
}
