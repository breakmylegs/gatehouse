# ADR 0003: Artifact sandboxing

Status: Proposed, 31 Oct 2026. Waiting for the owner.

## Context

G6 asks for artifacts: HTML, React, Mermaid and Markdown pages that Claude makes in a chat, shown live, with versions and export. Two facts from the code shape this.

- A chat always runs in Plan mode (`apps/host/src/sessions.ts`, owner decision), so Claude cannot write files there.
- The window host (`packaging/JCVCApp.cs`) filters only top-level navigation and new windows. It does not filter what a frame inside the page loads.

## What was checked

- The existing file preview route (`apps/host/src/files-api.ts`, `/preview/<token>/...`) sends `Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:`. That keeps a page in an opaque origin, but `'self'` still lets it reach the Host's own address.
- A sandboxed page cannot read the window's session token, which lives in the main page's sessionStorage. Its requests carry `Origin: null`, which the Host refuses (invariant 7).
- The engine is Chromium 156 (WebView2 runtime 156.0.4314.50 here). Not yet tested here: that CSP `sandbox`, `connect-src 'none'` and the iframe `sandbox` attribute hold inside the packaged window. The verification below tests exactly that.

## Options

1. **Claude writes artifact files.** Not possible in Plan mode, and Plan mode is an owner decision.
2. **An in-process Companion tool, `save_artifact`.** Claude calls it with a title, a kind and the content. The Host stores each version under `%LOCALAPPDATA%\Gatehouse\artifacts\<chat>\`, redacted first, and audits it. Constraint 3 holds, because the Companion is already an in-process SDK MCP server.
3. **Render from the transcript text.** No tool, but nothing to version or export, and no audit entry.

## Proposed decision

Option 2, rendered like this:

- Served from a new route, `/artifact/<token>/<version>`, with `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; frame-ancestors <the window's origin>`, plus `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
- Shown in an `iframe` with `sandbox="allow-scripts"` and no other flag: no same origin, forms, pop-ups or top navigation. `referrerpolicy="no-referrer"`.
- React and Mermaid run from vetted copies the Host serves under `/artifact-lib/`, never from a CDN. So `connect-src 'none'` can stay.
- Data analysis (G7) runs in the same sandbox: Claude writes a page with the data and the chart code, and the browser sandbox runs it. Nothing runs on the computer itself.

## Consequences

- Artifacts never reach the network, even when Claude writes a fetch call.
- New dependency for Mermaid pages: `mermaid` 12.2.0 (MIT). It pulls in DOMPurify (MPL-2.0 or Apache-2.0). Listed in the Wave 1 package table.
- Export writes the stored HTML file as it is. Share links are out of scope, and nothing is published.

## Constraint check

Fits: no network, only the in-process MCP route, redaction before storage, an audit entry per version.

## Verification

Automated: a route test checks the headers. An end-to-end check in headless Edge loads an artifact that tries `fetch`, `XMLHttpRequest`, `WebSocket`, a form post, `top.location` and `window.open`, and expects every one to fail. Named manual check: the same page in the packaged window.
