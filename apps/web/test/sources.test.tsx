// @vitest-environment jsdom
// W1-10, ADR 0007: a chat's sources, built from the search results Claude Code records (the recorded shape below) and
// the pages it read, numbered as Claude cites them, each marked as from the web and untrusted.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { SourcesPane } from "../src/components/SourcesPane"
import { siteOf, sourcesOf } from "../src/lib/sources"
import { emptyTranscript, reduce, searchResults } from "../src/lib/transcript"

// The shape of tool_use_result for a web search, as recorded in a real transcript (1 Nov).
const RECORDED = {
  query: "office ui fabric react latest version",
  results: [
    {
      tool_use_id: "srvtoolu_1",
      content: [
        {
          title: "office ui fabric react",
          url: "https://classic.yarnpkg.com/en/package/office-ui-fabric-react",
        },
        {
          title: "bettersolutions.com",
          url: "https://bettersolutions.com/javascript/fluent-ui/index.htm",
        },
        { title: "Not a web page", url: "javascript:alert(1)" },
      ],
    },
    "The most recent version I found is 9.56.5, but the sources disagree.",
  ],
  durationSeconds: 2.1,
  searchCount: 1,
}

function chatWithSearch() {
  let t = emptyTranscript()
  t = reduce(t, {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "tu-s", name: "WebSearch", input: { query: RECORDED.query } },
      ],
    },
  })
  t = reduce(t, {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "tu-s", content: "Web search results..." }],
    },
    tool_use_result: RECORDED,
  })
  t = reduce(t, {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "tu-f",
          name: "WebFetch",
          input: {
            url: "https://bettersolutions.com/javascript/fluent-ui/index.htm",
            prompt: "version",
          },
        },
      ],
    },
  })
  t = reduce(t, {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "tu-f", content: "Fluent UI 9.56.5" }],
    },
  })
  return t
}

afterEach(cleanup)

describe("a chat's sources", () => {
  it("reads search results from the recorded shape, keeping only web addresses", () => {
    expect(searchResults(RECORDED).map((r) => r.url)).toEqual([
      "https://classic.yarnpkg.com/en/package/office-ui-fabric-react",
      "https://bettersolutions.com/javascript/fluent-ui/index.htm",
    ])
    expect(searchResults({ results: "nothing" })).toEqual([])
    expect(searchResults(undefined)).toEqual([])
  })

  it("numbers each address once, in order, and marks the pages read in full", () => {
    const sources = sourcesOf(chatWithSearch().items)
    expect(sources.map((s) => [s.n, siteOf(s.url), s.read])).toEqual([
      [1, "classic.yarnpkg.com", false],
      [2, "bettersolutions.com", true],
    ])
  })

  it("shows them numbered, opening outside Codehouse, each marked as from the web and untrusted", () => {
    render(<SourcesPane items={chatWithSearch().items} />)
    const list = screen.getByRole("list", { name: "Sources" })
    const rows = within(list).getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    const link = within(rows[0]!).getByRole("link", { name: "office ui fabric react" })
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noreferrer")
    for (const r of rows) expect(r.textContent).toContain("from the web, untrusted")
    expect(rows[1]!.textContent).toContain("Read")
  })
})
