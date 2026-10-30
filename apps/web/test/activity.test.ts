import { describe, expect, it } from "vitest"
import {
  describeActivity,
  describePulse,
  nextActivity,
  nextPulse,
  STALL_MS,
  type Activity,
} from "../src/lib/activity"

const ev = (event: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "stream_event",
  event,
  ...extra,
})

/** Feeds messages in order, one second apart, and returns every activity on the way. */
function run(messages: unknown[], start?: Activity): Array<Activity | undefined> {
  const out: Array<Activity | undefined> = []
  let a = start
  messages.forEach((m, i) => {
    a = nextActivity(a, m, 1000 * (i + 1))
    out.push(a)
  })
  return out
}

describe("what a running session is doing", () => {
  it("follows a large Write from the first token to the end of the turn", () => {
    // The JSON arrives in small pieces; the path is split across two of them and escaped as JSON escapes it.
    const pieces = ['{"file_path": "C:\\\\dev\\\\Te', 'st\\\\minisheet.html", "content": "<html>']
    for (let i = 0; i < 400; i++) pieces.push("<td>cell</td>".repeat(8))
    const steps = run([
      ev({ type: "message_start" }),
      ev({ type: "content_block_start", content_block: { type: "tool_use", name: "Write" } }),
      ...pieces.map((p) =>
        ev({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: p } }),
      ),
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu9",
              name: "Write",
              input: { file_path: "C:\\dev\\Test\\minisheet.html" },
            },
          ],
        },
      },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu9" }] } },
      { type: "result", subtype: "success" },
    ])
    expect(steps[0]).toMatchObject({ phase: "thinking" })
    const writing = steps[2 + pieces.length - 1]
    expect(writing).toMatchObject({
      phase: "preparing",
      tool: "Write",
      target: "C:\\dev\\Test\\minisheet.html",
      chars: pieces.join("").length,
    })
    const line = describeActivity(writing, writing!.since + 42_000)
    expect(line.label).toBe("Claude is writing C:\\dev\\Test\\minisheet.html")
    expect(line.detail).toBe(
      `${pieces.join("").length.toLocaleString("en-GB")} characters so far, 42 s`,
    )
    expect(line.hint).toMatch(/whole file before JCVC can check it/)
    expect(steps.at(-3)).toMatchObject({ phase: "running", tool: "Write", toolUseId: "tu9" })
    expect(steps.at(-2)).toMatchObject({ phase: "thinking" })
    expect(steps.at(-1)).toBeUndefined()
  })

  it("leaves a subagent's messages out, so its work shows as the call that started it", () => {
    const running: Activity = { phase: "running", since: 1, tool: "Task", toolUseId: "t1" }
    const after = nextActivity(
      running,
      ev({ type: "message_start" }, { parent_tool_use_id: "t1" }),
      5000,
    )
    expect(after).toBe(running)
  })

  it("keeps the same object while nothing changes, so the screen does not redraw for it", () => {
    const thinking: Activity = { phase: "thinking", since: 1 }
    expect(nextActivity(thinking, ev({ type: "message_start" }), 2)).toBe(thinking)
    expect(nextActivity(thinking, ev({ type: "ping" }), 2)).toBe(thinking)
    expect(nextActivity(thinking, { type: "system", subtype: "init" }, 2)).toBe(thinking)
  })

  it("says a prompt is on its way, and why the first answer can be slow", () => {
    const sent: Activity = { phase: "sent", since: 0 }
    expect(describeActivity(sent, 5_000)).toEqual({
      label: "Sent. Waiting for Claude to start",
      detail: "5 s",
    })
    expect(describeActivity(sent, 25_000).hint).toMatch(/first answer/)
  })

  it("names a shell command by its first line", () => {
    const a = nextActivity(
      undefined,
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Running the tests" },
            {
              type: "tool_use",
              id: "x",
              name: "PowerShell",
              input: { command: "npm test\nnpm run lint" },
            },
          ],
        },
      },
      0,
    )
    expect(describeActivity(a, 3_000).label).toBe("Running a shell command (npm test)")
  })
})

describe("the place a call acts on", () => {
  it("is written from the session's folder when it is inside it, with either kind of slash", () => {
    const a: Activity = {
      phase: "running",
      since: 0,
      tool: "Edit",
      toolUseId: "x",
      target: "C:/dev/Billing/src/app.ts",
    }
    expect(describeActivity(a, 0, "c:\\dev\\billing\\").label).toBe("Running Edit (src\\app.ts)")
    // A folder whose name only starts the same is not inside it.
    expect(describeActivity(a, 0, "C:\\dev\\Bill").label).toBe(
      "Running Edit (C:/dev/Billing/src/app.ts)",
    )
  })
})

describe("the pulse of a running turn", () => {
  const ev = (event: Record<string, unknown>) => ({ type: "stream_event", event })

  it("adds up the tokens Claude writes across the messages of a turn", () => {
    let p = nextPulse(undefined, ev({ type: "message_start" }), 0)
    p = nextPulse(p, ev({ type: "message_delta", usage: { output_tokens: 1200 } }), 1000)
    p = nextPulse(p, ev({ type: "message_start" }), 2000)
    p = nextPulse(p, ev({ type: "message_delta", usage: { output_tokens: 1300 } }), 3000)
    expect(describePulse(p, 3000).tokens).toBe("2.5k tokens")
    expect(nextPulse(p, { type: "result" }, 4000)).toBeUndefined()
  })

  it("says how long it has been quiet, and calls two quiet minutes possibly stuck", () => {
    const p = nextPulse(undefined, ev({ type: "ping" }), 0)
    expect(describePulse(p, 5_000)).toEqual({ stuck: false })
    expect(describePulse(p, 40_000)).toEqual({ quiet: "last activity 40 s ago", stuck: false })
    expect(describePulse(p, STALL_MS).stuck).toBe(true)
    // Anything arriving, even a partial message, counts as a sign of life.
    const later = nextPulse(p, ev({ type: "content_block_delta" }), STALL_MS - 1000)
    expect(describePulse(later, STALL_MS).stuck).toBe(false)
  })
})
