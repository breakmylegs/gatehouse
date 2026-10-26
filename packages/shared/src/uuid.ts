import { randomBytes } from "node:crypto"

/** A UUIDv7 (RFC 9562): 48 bits of millisecond timestamp, then random bits, so ids sort by creation time. */
export function uuidv7(now: number = Date.now(), random: () => Buffer = () => randomBytes(10)): string {
  const bytes = Buffer.alloc(16)
  let ts = BigInt(now)
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ts & 0xffn)
    ts >>= 8n
  }
  random().copy(bytes, 6, 0, 10)
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70 // version 7
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80 // variant 10
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
