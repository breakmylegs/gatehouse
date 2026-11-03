import { MergeView, unifiedMergeView } from "@codemirror/merge"
import { defaultKeymap } from "@codemirror/commands"
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search"
import { EditorState, type Extension } from "@codemirror/state"
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view"
import { useEffect, useRef, useState } from "react"

/**
 * Codehouse's views of code (B11), on CodeMirror 6: a file, and a changed file before and after. Both are read only:
 * the keyboard moves through them, Ctrl+F searches, and nothing typed changes a file. CodeMirror draws only the lines
 * in view, so a file of several megabytes opens at once. (Chosen over Monaco: a fraction of the size, no web workers,
 * and strong screen reader support; see BUILD_REPORT, Phase 101.)
 */
const base = (label: string): Extension[] => [
  EditorState.readOnly.of(true),
  lineNumbers(),
  highlightSpecialChars(),
  drawSelection(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  search({ top: true }),
  keymap.of([...searchKeymap, ...defaultKeymap]),
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({ "aria-label": label, "aria-readonly": "true" }),
  EditorView.theme({
    "&": { fontSize: "13px", backgroundColor: "var(--c-s1)", color: "var(--c-tx)" },
    ".cm-content": { fontFamily: "var(--font-code)" },
    ".cm-gutters": {
      backgroundColor: "var(--c-s2)",
      color: "var(--c-mut)",
      borderRight: "1px solid var(--c-line)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--c-acc) 8%, transparent)" },
    "&.cm-focused": { outline: "2px solid var(--c-acc)", outlineOffset: "-2px" },
  }),
]

/** A file's text, read only, with line numbers and search. */
export function CodeView({ text, label }: { text: string; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ doc: text, extensions: base(label), parent: host.current })
    return () => view.destroy()
  }, [text, label])
  return <div ref={host} className="code-view" data-testid="code-view" />
}

export type DiffLayout = "side" | "inline"
const LAYOUT_KEY = "gatehouse.diff.layout"

/** The layout you chose last, side by side unless you chose inline. */
export function readLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "inline" ? "inline" : "side"
  } catch {
    return "side"
  }
}

/**
 * A changed file before and after, side by side or inline, read only. Unchanged stretches fold away, with a few
 * lines kept around each change. A file made since has no before; a file removed has no after.
 */
export function DiffView({ path, before, after }: { path: string; before: string; after: string }) {
  const [layout, setLayout] = useState<DiffLayout>(readLayout)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const collapse = { margin: 3, minSize: 6 }
    if (layout === "side") {
      const mv = new MergeView({
        a: { doc: before, extensions: base(`${path}, as it was`) },
        b: { doc: after, extensions: base(`${path}, as it is now`) },
        parent,
        collapseUnchanged: collapse,
      })
      return () => mv.destroy()
    }
    const view = new EditorView({
      doc: after,
      extensions: [
        ...base(`${path}, as it is now, with what changed shown in place`),
        unifiedMergeView({ original: before, mergeControls: false, collapseUnchanged: collapse }),
      ],
      parent,
    })
    return () => view.destroy()
  }, [layout, before, after, path])
  const choose = (l: DiffLayout) => {
    setLayout(l)
    try {
      localStorage.setItem(LAYOUT_KEY, l)
    } catch {
      // storage blocked: the choice lasts until the window closes
    }
  }
  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label="How to show the changes" className="flex gap-1">
        {(
          [
            ["side", "Side by side"],
            ["inline", "Inline"],
          ] as const
        ).map(([l, label]) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={layout === l}
            className="pane-tool"
            onClick={() => choose(l)}
          >
            {label}
          </button>
        ))}
      </div>
      <div ref={host} className="diff-view" data-layout={layout} data-testid="diff-view" />
    </div>
  )
}
