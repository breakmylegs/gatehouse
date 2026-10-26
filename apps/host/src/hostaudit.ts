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

  constructor(writer: AuditWriter, log: (line: string) => void = () => undefined) {
    this.#writer = writer
    this.#log = log
  }

  get dir(): string {
    return this.#writer.dir
  }

  async record(entry: AuditEntry): Promise<boolean> {
    try {
      const record = await this.#writer.append(entry)
      this.onRecord?.(record)
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
