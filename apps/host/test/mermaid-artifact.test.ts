// C-057: Mermaid diagrams drawn offline in the artifact sandbox. A hostile diagram cannot break out of its text, cannot
// loosen Mermaid's strict level with a directive, and is served under the same sandbox and policy as any page, which
// fetches nothing; a build without Mermaid shows the source, safely.
import { describe, expect, it } from "vitest"
import { AI_MARK, artifactHeaders, labelArtifact, mermaidPage } from "../src/artifacts.js"

const HOSTILE = [
  "graph TD",
  '%%{init: {"securityLevel": "loose", "startOnLoad": true, "htmlLabels": true}}%%',
  'A["</pre><script>parent.postMessage(document.cookie, \'*\')</script>"] --> B',
  'click A "javascript:alert(1)"',
].join("\n")

describe("Mermaid artifacts (C-057)", () => {
  it("keeps a hostile diagram as text: no element closes early and no script of its own runs", () => {
    const page = mermaidPage(HOSTILE, "window.mermaid = { initialize: function () {}, run: function () { return Promise.resolve() } }")
    const pre = /<pre class="mermaid">([\s\S]*?)<\/pre>/.exec(page)![1]!
    expect(pre).not.toMatch(/<script|<\/pre/i)
    expect(pre).toContain("&lt;/pre&gt;&lt;script&gt;")
    // Exactly the two scripts the page brings: Mermaid's file and the call that draws.
    expect(page.match(/<script>/g)).toHaveLength(2)
    // Mermaid at its strict level, locked so the diagram's directive cannot loosen it.
    expect(page).toContain('securityLevel: "strict"')
    expect(page).toMatch(/secure: \[[^\]]*"securityLevel"[^\]]*"htmlLabels"/)
    expect(page).toContain(`content="${AI_MARK}"`)
  })

  it("inlines Mermaid's file without letting a </script> inside it end the script", () => {
    const page = mermaidPage("graph TD\nA-->B", 'var s = "</script><img src=x onerror=alert(1)>"')
    expect(page).not.toContain('"</script><img')
    expect(page).toContain('"<\\/script><img')
  })

  it("is served under the same sandbox as any page, which can fetch nothing, so it works offline", () => {
    const h = artifactHeaders("http://127.0.0.1:7777", "mermaid")
    expect(h["content-type"]).toMatch(/^text\/html/)
    expect(h["content-security-policy"]).toBe(artifactHeaders("http://127.0.0.1:7777", "html")["content-security-policy"])
    expect(h["content-security-policy"]).toMatch(/sandbox allow-scripts; default-src 'none'.*connect-src 'none'/)
    expect(h["content-security-policy"]).not.toMatch(/allow-same-origin|https?:\/\/(?!127\.0\.0\.1:7777)/)
  })

  it("shows the source, safely, in a build without Mermaid, and marks a diagram as made by AI", () => {
    const page = mermaidPage("<b>hi</b>", undefined)
    expect(page).not.toContain("<script")
    expect(page).toContain("&lt;b&gt;hi&lt;/b&gt;")
    expect(labelArtifact("mermaid", "graph TD\nA-->B")).toBe(`graph TD\nA-->B\n%% ${AI_MARK}\n`)
  })
})
