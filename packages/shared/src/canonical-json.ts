/**
 * Canonical JSON in the style of RFC 8785 (JCS): object keys sorted by UTF-16 code unit,
 * no insignificant whitespace, ECMAScript number and string serialisation.
 * Undefined object members are dropped. Other non-JSON values are rejected.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false"
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Cannot canonicalise a non-finite number")
      return JSON.stringify(value)
    case "string":
      return JSON.stringify(value)
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => canonicalize(v === undefined ? null : v)).join(",") + "]"
      }
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}"
    }
    default:
      throw new TypeError(`Cannot canonicalise a value of type ${typeof value}`)
  }
}
