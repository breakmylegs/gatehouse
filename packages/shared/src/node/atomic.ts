import fs from "node:fs"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Errors Windows raises transiently while a scanner or another process has a file open. */
export const TRANSIENT_FS_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"])

/**
 * Writes a file by writing a temporary file and renaming it over the target, so a reader never sees half
 * a file. Windows sometimes refuses the rename for a moment, so it retries. Throws if it cannot finish.
 */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  fs.writeFileSync(tmp, text)
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file)
        return
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? ""
        if (!TRANSIENT_FS_ERRORS.has(code) || attempt >= 40) throw e
        await sleep(5 + attempt * 2)
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}
