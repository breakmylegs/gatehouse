import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import { findProjectRoot } from "@gatehouse/policy"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"

/**
 * Your saved prompts (owner's plan, W1-14): a title and a text, which may hold {{variables}} to fill in on use. One
 * JSON file under %LOCALAPPDATA%\Gatehouse\, redacted before it is written like memory, written atomically and read
 * tolerantly: an entry this version cannot read is kept as it is, and a newer version's extra fields survive a change.
 */
export const MAX_PROMPTS = 200
export const MAX_TITLE = 80
export const MAX_PROMPT_TEXT = 20_000

export class PromptError extends Error {
  constructor(
    readonly code: "invalid" | "full" | "missing" | "exists",
    message: string,
  ) {
    super(message)
  }
}

export interface Prompt {
  id: string
  title: string
  text: string
  at: string
}

type Raw = Record<string, unknown>

export class PromptStore {
  readonly #file: string
  readonly #redact: (text: string) => string

  constructor(file: string, redact: (text: string) => string = (t) => t) {
    this.#file = path.resolve(file)
    this.#redact = redact
  }

  #read(): Raw[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.#file, "utf8")) as unknown
      return Array.isArray(v) ? v.filter((x): x is Raw => typeof x === "object" && x !== null) : []
    } catch {
      return []
    }
  }

  list(): Prompt[] {
    return this.#read()
      .filter(
        (r) =>
          typeof r.id === "string" && typeof r.title === "string" && typeof r.text === "string",
      )
      .map((r) => ({
        id: r.id as string,
        title: r.title as string,
        text: r.text as string,
        at: typeof r.at === "string" ? r.at : "",
      }))
  }

  get(id: string): Prompt | undefined {
    return this.list().find((p) => p.id === id)
  }

  /** Adds a prompt, or changes the one with this id. */
  async save(input: { id?: string; title: string; text: string }): Promise<Prompt> {
    const title = input.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE)
    const text = input.text.trim()
    if (!title || !text) throw new PromptError("invalid", "A prompt needs a title and its words.")
    if (text.length > MAX_PROMPT_TEXT)
      throw new PromptError("invalid", `A prompt can be up to ${MAX_PROMPT_TEXT} characters.`)
    const all = this.#read()
    const at = new Date().toISOString()
    const entry = { title: this.#redact(title), text: this.#redact(text), at }
    if (input.id) {
      const i = all.findIndex((r) => r.id === input.id)
      if (i < 0) throw new PromptError("missing", "That prompt is not there.")
      all[i] = { ...all[i], ...entry }
      await this.#write(all)
      return { id: input.id, ...entry }
    }
    if (all.length >= MAX_PROMPTS)
      throw new PromptError("full", `You can keep up to ${MAX_PROMPTS} prompts.`)
    const id = crypto.randomUUID()
    all.push({ id, ...entry })
    await this.#write(all)
    return { id, ...entry }
  }

  async remove(id: string): Promise<void> {
    const all = this.#read()
    const left = all.filter((r) => r.id !== id)
    if (left.length === all.length) throw new PromptError("missing", "That prompt is not there.")
    await this.#write(left)
  }

  async #write(all: Raw[]): Promise<void> {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(this.#file, JSON.stringify(all, null, 2) + "\n")
  }
}

/** A skill folder name from a title: letters, digits and hyphens. */
export const skillName = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)

/** A prompt as a Claude Code skill: a SKILL.md with a name and a one-line description. */
export function skillFile(p: Prompt): string {
  const description = p.title.replace(/[\r\n]+/g, " ").replace(/"/g, "'")
  return `---\nname: ${skillName(p.title)}\ndescription: "${description}"\n---\n\n${p.text}\n`
}

const bad = (reply: FastifyReply, e: unknown) => {
  if (e instanceof PromptError)
    return reply
      .code(e.code === "missing" ? 404 : e.code === "exists" ? 409 : e.code === "full" ? 409 : 400)
      .send({ error: e.message })
  throw e
}

export function registerPromptRoutes(
  app: FastifyInstance,
  ctx: {
    prompts?: PromptStore
    audit: HostAudit
    sessionCwd?: (id: string) => string | undefined
  },
): void {
  const store = () => {
    if (!ctx.prompts) throw new PromptError("missing", "Saved prompts are not available here.")
    return ctx.prompts
  }
  app.get("/api/prompts", async (_req, reply) => {
    try {
      return { prompts: store().list() }
    } catch (e) {
      return bad(reply, e)
    }
  })
  app.put("/api/prompts", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    try {
      return await store().save({
        ...(typeof b.id === "string" && b.id ? { id: b.id } : {}),
        title: typeof b.title === "string" ? b.title : "",
        text: typeof b.text === "string" ? b.text : "",
      })
    } catch (e) {
      return bad(reply, e)
    }
  })
  app.delete<{ Params: { id: string } }>("/api/prompts/:id", async (req, reply) => {
    try {
      await store().remove(req.params.id)
      return { ok: true }
    } catch (e) {
      return bad(reply, e)
    }
  })
  /**
   * Promote: the prompt becomes a skill in the project of a running session, as .claude/skills/<name>/SKILL.md, so
   * Claude Code offers it there. Never over an existing skill, and in the audit log.
   */
  app.post<{ Params: { id: string } }>("/api/prompts/:id/promote", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    try {
      const p = store().get(req.params.id)
      if (!p) throw new PromptError("missing", "That prompt is not there.")
      const cwd = typeof b.session === "string" ? ctx.sessionCwd?.(b.session) : undefined
      if (!cwd) throw new PromptError("missing", "That session is not running.")
      const name = skillName(p.title)
      if (!name) throw new PromptError("invalid", "That title makes no skill name.")
      const root = findProjectRoot(cwd)
      const file = path.join(root, ".claude", "skills", name, "SKILL.md")
      if (fs.existsSync(file))
        throw new PromptError("exists", `The project already has a skill called ${name}.`)
      const written = await ctx.audit.record({
        session: typeof b.session === "string" ? b.session : "desktop",
        event: "prompt_promoted",
        channel: "desktop",
        tool: "prompts",
        cwd: root,
        input: { skill: name },
        verdict: {
          outcome: "allow",
          ruleId: "prompt-promoted",
          reason: "A saved prompt was made a skill in this project from the desktop.",
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: "",
        },
        latencyMs: 0,
      })
      if (!written)
        return reply.code(503).send({ error: "It could not be recorded, so it was not written." })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, skillFile(p))
      return { skill: name, path: path.relative(root, file).split(path.sep).join("/") }
    } catch (e) {
      return bad(reply, e)
    }
  })
}
