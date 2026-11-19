import { execFile } from "node:child_process"

/**
 * T-134 (safe variant): a credential field (the Slack tokens, the ntfy token or password) may hold a 1Password
 * reference, `op://vault/item/field`, instead of the value. The connector is off until you switch it on in Settings.
 * When on, the value is read with 1Password's own `op read` each time it is needed, started directly (no shell), and:
 * - never stored: the sealed store keeps only the reference;
 * - added to the redaction terms at once, so it is taken out of the audit, logs and anything sent (invariant 12);
 * - refused when it is an Anthropic credential: Codehouse never uses one (invariant 6).
 */
export const OP_REF = /^op:\/\/[^\s/]{1,100}\/[^\s/]{1,100}(\/[^\s/]{1,100}){1,2}$/
export const isOpRef = (v: unknown): v is string => typeof v === "string" && OP_REF.test(v)
const ANTHROPIC = /sk-ant-|ANTHROPIC|CLAUDE_CODE_OAUTH/i
const READ_MS = 15_000

export class SecretProviderError extends Error {}

/** Values read from a provider while Codehouse runs, for the redactor. Never written anywhere. */
export class SecretTerms {
  readonly #terms = new Set<string>()
  add(v: string): void {
    if (v.length >= 6) this.#terms.add(v)
  }
  terms(): string[] {
    return [...this.#terms]
  }
}

export interface SecretProviderDeps {
  /** Whether the 1Password connector is switched on. */
  enabled: () => boolean
  terms: SecretTerms
  /** Runs a program without a shell; its standard output. */
  run?: (file: string, args: string[]) => Promise<string>
}

const runOp = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: READ_MS, windowsHide: true, shell: false, maxBuffer: 64 * 1024 }, (err, stdout) =>
      err ? reject(new Error((err as NodeJS.ErrnoException).code === "ENOENT" ? "1Password's op command is not installed." : "op could not read it.")) : resolve(stdout),
    )
  })

/** A field's value: as it is when it is not a reference, else read from 1Password now. Throws with a reason in words. */
export async function resolveSecret(v: string | undefined, d: SecretProviderDeps): Promise<string | undefined> {
  if (v === undefined || !isOpRef(v)) return v
  if (/anthropic|claude/i.test(v)) throw new SecretProviderError("That reference names an Anthropic credential. Codehouse never uses one.")
  if (!d.enabled()) throw new SecretProviderError("This field holds a 1Password reference, and 1Password is switched off in Settings.")
  let value: string
  try {
    value = (await (d.run ?? runOp)("op", ["read", "--no-newline", v])).replace(/\r?\n$/, "")
  } catch (e) {
    throw new SecretProviderError(`1Password: ${(e as Error).message}`)
  }
  if (!value) throw new SecretProviderError("1Password gave nothing for that reference.")
  if (ANTHROPIC.test(value)) throw new SecretProviderError("1Password gave an Anthropic credential. Codehouse never uses one.")
  d.terms.add(value)
  return value
}
