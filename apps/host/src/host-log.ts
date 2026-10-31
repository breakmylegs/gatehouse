import fs from "node:fs"
import path from "node:path"
import { redactString } from "@gatehouse/policy"

/** The log is kept to two files of this size: the current one and the one before. */
export const MAX_LOG_BYTES = 2 * 1024 * 1024

/**
 * The Host's log, kept in %LOCALAPPDATA%\Gatehouse\host.log as well as on its error output, so why a session
 * stopped can still be read after JCVC restarts (owner, 31 Oct). Redacted before it is written (invariant 12),
 * with the redaction list once the settings are known. A failure to write never stops the Host.
 */
export function fileLog(file: string): {
  write: (line: string) => void
  setTerms: (terms: () => string[]) => void
} {
  let terms: () => string[] = () => []
  return {
    setTerms: (t) => {
      terms = t
    },
    write: (line) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES)
          fs.renameSync(file, `${file}.1`)
        const text = redactString(line, { terms: terms() })
        fs.appendFileSync(file, `${new Date().toISOString()} ${text}\n`)
      } catch {
        // The log is for reading later; the Host carries on without it.
      }
    },
  }
}
