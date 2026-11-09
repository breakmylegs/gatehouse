/**
 * The task board (backlog G24): cards across sessions in four columns, To do, Running, Review and Done. Moving a card
 * to Running starts a session for it in its folder with its prompt, through the same path as any session (the kill
 * switch, the sign-in and organisation check, the session limit and every rule), recorded first. Kept in
 * %LOCALAPPDATA%\Gatehouse\board.json, written atomically and read tolerantly, so the board survives a restart.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"

export const COLUMNS = ["todo", "running", "review", "done"] as const
export type Column = (typeof COLUMNS)[number]

export interface Card {
  id: string
  title: string
  prompt: string
  folder: string
  column: Column
  /** The session started for it, once it went to Running. */
  sessionId?: string
  createdAt: string
}

export class BoardError extends Error {}

const MAX_CARDS = 200

/** A card as given, checked; anything wrong is refused with a reason in words. */
export function checkCard(c: Partial<Card>): Pick<Card, "title" | "prompt" | "folder"> {
  const title = String(c.title ?? "").trim()
  const prompt = String(c.prompt ?? "").trim()
  const folder = String(c.folder ?? "").trim()
  if (!title || title.length > 120)
    throw new BoardError("A card needs a title of up to 120 characters.")
  if (prompt.length > 8000) throw new BoardError("A card's prompt is up to 8,000 characters.")
  if (folder && !/^[A-Za-z]:[\\/]/.test(folder))
    throw new BoardError("A card's folder is a full path, such as C:\\dev\\shop.")
  return { title, prompt, folder }
}

export class BoardStore {
  readonly #file: string
  #cards: Card[] = []
  #extra: Record<string, unknown> = {}

  constructor(file: string) {
    this.#file = file
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      const { cards, ...rest } = raw
      this.#extra = rest
      for (const x of (Array.isArray(cards) ? cards : []) as Array<Partial<Card>>) {
        try {
          const ok = checkCard(x)
          if (typeof x.id !== "string") continue
          this.#cards.push({
            id: x.id,
            ...ok,
            column: (COLUMNS as readonly string[]).includes(String(x.column))
              ? (x.column as Column)
              : "todo",
            ...(typeof x.sessionId === "string" ? { sessionId: x.sessionId } : {}),
            createdAt: typeof x.createdAt === "string" ? x.createdAt : new Date(0).toISOString(),
          })
        } catch {
          // one a newer version wrote, or a broken one: left out
        }
      }
    } catch {
      // none yet
    }
  }

  list(): Card[] {
    return this.#cards.map((c) => ({ ...c }))
  }

  get(id: string): Card | undefined {
    const c = this.#cards.find((x) => x.id === id)
    return c ? { ...c } : undefined
  }

  async #save(): Promise<void> {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(
      this.#file,
      JSON.stringify({ ...this.#extra, version: 1, cards: this.#cards }, null, 2) + "\n",
    )
  }

  /** Adds a card to To do, or changes one's words. */
  async put(c: Partial<Card>): Promise<Card> {
    const ok = checkCard(c)
    const at = this.#cards.findIndex((x) => x.id === c.id)
    if (at >= 0) {
      this.#cards[at] = { ...this.#cards[at]!, ...ok }
      await this.#save()
      return { ...this.#cards[at]! }
    }
    if (this.#cards.length >= MAX_CARDS) throw new BoardError(`Up to ${MAX_CARDS} cards.`)
    const card: Card = {
      id: crypto.randomUUID(),
      ...ok,
      column: "todo",
      createdAt: new Date().toISOString(),
    }
    this.#cards.push(card)
    await this.#save()
    return { ...card }
  }

  /** Moves a card to a column, at a place in it (the end when absent). */
  async move(id: string, column: Column, index?: number, sessionId?: string): Promise<Card> {
    const at = this.#cards.findIndex((x) => x.id === id)
    if (at < 0) throw new BoardError("There is no such card.")
    const card: Card = { ...this.#cards[at]!, column, ...(sessionId ? { sessionId } : {}) }
    const rest = this.#cards.filter((x) => x.id !== id)
    const inColumn = rest.filter((x) => x.column === column)
    const before = inColumn[Math.max(0, Math.min(index ?? inColumn.length, inColumn.length))]
    const where = before ? rest.indexOf(before) : rest.length
    rest.splice(where, 0, card)
    this.#cards = rest
    await this.#save()
    return { ...card }
  }

  async remove(id: string): Promise<boolean> {
    const before = this.#cards.length
    this.#cards = this.#cards.filter((x) => x.id !== id)
    if (this.#cards.length === before) return false
    await this.#save()
    return true
  }
}

export interface BoardContext {
  board: BoardStore
  audit: HostAudit
  /** Starts a session in the folder with the prompt; throws when it cannot. Returns its id. */
  start: (card: Card) => Promise<string>
}

/** GET /api/board, PUT and DELETE /api/board/cards, POST /api/board/move. Desktop only, like every admin route. */
export function registerBoardRoutes(app: FastifyInstance, ctx: BoardContext): void {
  const bad = (
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    n: number,
    error: string,
  ) => reply.code(n).send({ error })
  app.get("/api/board", async () => ({ cards: ctx.board.list() }))
  app.put("/api/board/cards", async (req, reply) => {
    try {
      return { card: await ctx.board.put((req.body ?? {}) as Partial<Card>) }
    } catch (e) {
      if (e instanceof BoardError) return bad(reply, 422, e.message)
      throw e
    }
  })
  app.delete("/api/board/cards/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id
    if (!(await ctx.board.remove(id))) return bad(reply, 404, "There is no such card.")
    return { ok: true }
  })
  app.post("/api/board/move", async (req, reply) => {
    const b = (req.body ?? {}) as { id?: unknown; column?: unknown; index?: unknown }
    if (typeof b.id !== "string" || !(COLUMNS as readonly string[]).includes(String(b.column)))
      return bad(reply, 422, "Say which card and which column.")
    const card = ctx.board.get(b.id)
    if (!card) return bad(reply, 404, "There is no such card.")
    const column = b.column as Column
    const index = typeof b.index === "number" && Number.isInteger(b.index) ? b.index : undefined
    // Into Running for the first time: its session starts, recorded first; not recorded, not started, not moved.
    if (column === "running" && !card.sessionId) {
      if (!card.folder)
        return bad(
          reply,
          422,
          "Give the card a folder first, so its session has somewhere to work.",
        )
      if (!card.prompt)
        return bad(reply, 422, "Give the card a prompt first, so its session knows what to do.")
      const recorded = await ctx.audit.record({
        session: "desktop",
        event: "board_card_started",
        channel: "desktop",
        tool: "board",
        cwd: card.folder,
        input: { card: card.id, title: card.title },
        verdict: {
          outcome: "allow",
          ruleId: "board-card-started",
          reason: "You moved a card to Running on the task board, which starts its session.",
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: "",
        },
        latencyMs: 0,
      })
      if (!recorded)
        return bad(reply, 503, "It could not be recorded, so the session did not start.")
      let sessionId: string
      try {
        sessionId = await ctx.start(card)
      } catch (e) {
        return bad(reply, 409, `The session did not start: ${(e as Error).message}`)
      }
      return { card: await ctx.board.move(card.id, column, index, sessionId) }
    }
    return { card: await ctx.board.move(card.id, column, index) }
  })
}
