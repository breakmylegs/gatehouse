# ADR 0019: Artifact views for documents and code

Status: **Decided, 4 Nov 2026**, with the Chat plan (`docs/plan/chat-build-plan.md` section 8). Extends ADR 0003. Built in CH-03.

## Context

The owner's Chat build prompt asks for artifacts in Markdown, code, Mermaid, SVG and HTML, with HTML and SVG in a sandboxed frame without `allow-same-origin`, a policy that blocks all network access, and no access to the Host token. ADR 0003 built HTML and SVG that way.

## Decision

- **Two more kinds, `markdown` and `code`**, saved with the same Companion tool (`save_artifact`), versioned, redacted and audited as before.
- **Shown as text, never run.** The pane reads their words through the admin API (the export route, behind the Host's guard) and shows a document with the app's own Markdown view, which does not render HTML written inside it, and code with the app's code view. Neither goes into a frame, so there is nothing to sandbox.
- **Marked as made by AI** (B38): a document carries a comment Markdown does not show; code is left exactly as written, since a comment would depend on its language, and is marked by its headers (`x-ai-generated`) like every artifact.
- **Kept and exported** as `.md` and `.txt` files; Copy puts the text on the clipboard.
- **Mermaid** stays out until its licences are checked (plan question 3); a diagram is an SVG until then.
