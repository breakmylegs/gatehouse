import fs from "node:fs"
import path from "node:path"

/**
 * CNW's data: one JSON file per kind in its data folder (a docker volume), written atomically (a temporary file, then
 * a rename), read tolerantly: anything it does not know is kept, so an older and a newer CNW can read each other's
 * files after an update is undone. No native addons, so no database.
 */
export class JsonStore<T extends object> {
  readonly #file: string
  readonly #empty: () => T
  #cache: T | undefined

  constructor(dir: string, name: string, empty: () => T) {
    this.#file = path.join(dir, `${name}.json`)
    this.#empty = empty
  }

  read(): T {
    if (this.#cache) return this.#cache
    try {
      const v = JSON.parse(fs.readFileSync(this.#file, "utf8")) as unknown
      this.#cache = v && typeof v === "object" ? { ...this.#empty(), ...(v as T) } : this.#empty()
    } catch {
      this.#cache = this.#empty()
    }
    return this.#cache
  }

  write(next: T): void {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    const tmp = `${this.#file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, this.#file)
    this.#cache = next
  }

  update(fn: (cur: T) => T): T {
    const next = fn(this.read())
    this.write(next)
    return next
  }
}
