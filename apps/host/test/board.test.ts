// Backlog G24: a task board across sessions; a card moved to Running starts its session, recorded first; the board
// survives a restart.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterAll, describe, expect, it, vi } from "vitest"
import { BoardStore, registerBoardRoutes } from "../src/board.js"

// Mac fork: a full folder in this system's own form (C:\dev\shop is /dev/shop on a Mac).
const F = (p: string) => (process.platform === "win32" ? p : p.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/"))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-board-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the task board", () => {
  it("keeps cards in their columns and places, across a restart, and keeps what it does not know", async () => {
    const file = path.join(dir, "board.json")
    fs.writeFileSync(file, JSON.stringify({ version: 1, cards: [], newer: { kept: true } }))
    const board = new BoardStore(file)
    const a = await board.put({ title: "Add a basket", folder: F("C:\\dev\\shop"), prompt: "Add it." })
    const b = await board.put({ title: "Fix the logo" })
    await board.put({ title: "Write docs" })
    await board.move(b.id, "review")
    await board.move(a.id, "review", 0)
    const again = new BoardStore(file)
    const column = (name: string) =>
      again
        .list()
        .filter((c) => c.column === name)
        .map((c) => c.title)
    expect(column("review")).toEqual(["Add a basket", "Fix the logo"])
    expect(column("todo")).toEqual(["Write docs"])
    expect(JSON.parse(fs.readFileSync(file, "utf8")).newer).toEqual({ kept: true })
    await expect(board.put({ title: "" })).rejects.toThrow(/title/)
    await expect(board.put({ title: "x", folder: "shop" })).rejects.toThrow(/full path/)
  })

  it("starts a card's session when it first goes to Running, recorded first, and only once", async () => {
    const board = new BoardStore(path.join(dir, "start.json"))
    const card = await board.put({
      title: "Basket",
      folder: F("C:\\dev\\shop"),
      prompt: "Add a basket.",
    })
    const bare = await board.put({ title: "No folder" })
    const recorded: string[] = []
    let canRecord = false
    const start = vi.fn(async () => "s1")
    const app = Fastify()
    registerBoardRoutes(app, {
      board,
      audit: {
        record: async (r: { event: string }) => (recorded.push(r.event), canRecord),
      } as never,
      start,
    })
    const move = (id: string, column: string) =>
      app.inject({ method: "POST", url: "/api/board/move", payload: { id, column } })
    expect((await move(card.id, "running")).statusCode).toBe(503)
    expect(start).not.toHaveBeenCalled()
    expect(board.get(card.id)?.column).toBe("todo")
    canRecord = true
    expect((await move(bare.id, "running")).statusCode).toBe(422)
    const r = await move(card.id, "running")
    expect(r.json().card).toMatchObject({ column: "running", sessionId: "s1" })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Add a basket." }))
    // Back to To do and to Running again: the same session, not a second one.
    await move(card.id, "todo")
    await move(card.id, "running")
    expect(start).toHaveBeenCalledTimes(1)
    expect(recorded).toEqual(["board_card_started", "board_card_started"])
    expect((await move(card.id, "nowhere")).statusCode).toBe(422)
    await app.close()
  })
})
