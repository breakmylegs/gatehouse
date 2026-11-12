import type { AuditEntry, AuditRecord, AuditWriter } from "@gatehouse/shared/audit"

/**
 * The Host's way into the audit log. It records and reports whether the record was written, because an
 * allow that cannot be recorded must not be given (invariants 1 and 13): the caller decides what to do.
 */
export class HostAudit {
  readonly #writer: AuditWriter
  readonly #log: (line: string) => void
  /** Called after every record that was written, so the UI can stream the audit log. */
  onRecord: ((record: AuditRecord) => void) | undefined
  /** Others told of each record too, such as the local telemetry export (B36). A listener that throws is ignored. */
  readonly listeners = new Set<(record: AuditRecord) => void>()

  constructor(writer: AuditWriter, log: (line: string) => void = () => undefined) {
    this.#writer = writer
    this.#log = log
  }

  get dir(): string {
    return this.#writer.dir
  }

  /** D-030: records, and gives back the record with its place in the chain; undefined when it could not be written. */
  async recordWithHash(entry: AuditEntry): Promise<{ seq: number; hash: string; ts: string } | undefined> {
    try {
      const record = await this.#writer.append(entry)
      this.onRecord?.(record)
      for (const f of this.listeners)
        try {
          f(record)
        } catch {
          // a listener's failure never stops the record
        }
      return { seq: record.seq, hash: record.hash, ts: record.ts }
    } catch (e) {
      this.#log(`audit append failed (${(e as NodeJS.ErrnoException).code ?? (e as Error).name})`)
      return undefined
    }
  }

  async record(entry: AuditEntry): Promise<boolean> {
    try {
      const record = await this.#writer.append(entry)
      this.onRecord?.(record)
      for (const f of this.listeners)
        try {
          f(record)
        } catch {
          // a listener's failure never stops the record
        }
      return true
    } catch (e) {
      this.#log(`audit append failed (${(e as NodeJS.ErrnoException).code ?? (e as Error).name})`)
      return false
    }
  }

  head() {
    return this.#writer.head()
  }
}
