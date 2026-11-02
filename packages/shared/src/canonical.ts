import { createHash } from "node:crypto"

export { canonicalize } from "./canonical-json.js"

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}
