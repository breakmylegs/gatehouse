import { useEffect, useState } from "react"
import { trayName } from "../lib/platform-mac" // Mac fork
import { chooseHotkey, savedHotkey, useHotkeyState } from "../lib/quickKey"
import { inShell } from "../lib/shell"

/** Settings: the quick prompt's shortcut (W1-15), with three free ones offered when another program has it. */
export function QuickKeyPanel() {
  const state = useHotkeyState()
  const [text, setText] = useState(savedHotkey)
  useEffect(() => {
    if (state.kind === "ok") setText(state.text)
  }, [state])
  if (!inShell())
    return (
      <p className="m-0 text-xs text-mut">
        The quick prompt is part of the Codehouse window, so it has no shortcut in a browser.
      </p>
    )
  const said =
    state.kind === "ok"
      ? `${state.text} opens the quick prompt, from any program.`
      : state.kind === "off"
        ? `No shortcut. The quick prompt is still in the ${trayName()} menu.` // Mac fork
        : state.kind === "bad"
          ? state.error
          : state.kind === "clash"
            ? `Another program already uses ${state.text}, so the shortcut did not change. These are free:`
            : ""
  return (
    <>
      <p className="m-0 text-xs text-mut">
        A small window over whatever you are doing: start a chat, or message the coding session you
        started last. Esc puts it away and gives the focus back. It is in the {trayName()} menu too.
        {/* Mac fork: trayName */}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          chooseHotkey(text)
        }}
      >
        <label className="grid gap-1 text-sm">
          <span>Shortcut</span>
          <input
            className="field w-56"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button className="btn" disabled={!text.trim()}>
          Use this shortcut
        </button>
        <button type="button" className="btn" onClick={() => chooseHotkey("")}>
          No shortcut
        </button>
      </form>
      <p role="status" className="m-0 text-xs">
        {said}
      </p>
      {state.kind === "clash" && state.alternatives.length ? (
        <div className="flex flex-wrap gap-2">
          {state.alternatives.map((a) => (
            <button
              key={a}
              type="button"
              className="btn mono !min-h-7 !text-[12.5px]"
              onClick={() => {
                setText(a)
                chooseHotkey(a)
              }}
            >
              {a}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
