import { useId, useState } from "react"
import { useStore } from "../store"
import { INTERVALS, noteLines, updateCall, when } from "../lib/update"

/** Settings, Updates: the version you have, how often JCVC looks for a newer one, skipped versions and going back. */
export function UpdatesPanel() {
  const u = useStore((s) => s.update)
  const intervalId = useId()
  const tokenId = useId()
  const [confirmBack, setConfirmBack] = useState(false)
  const [token, setToken] = useState("")

  if (!u) return <p className="m-0 text-sm text-mut">Reading the update settings.</p>
  const target = u.latest?.version
  const status = u.checking
    ? "Looking for a new version."
    : u.checkError
      ? `The last check did not work: ${u.checkError}`
      : u.available && target
        ? `Version ${target} is available.`
        : u.lastCheck
          ? `You have the newest version. Checked at ${when(u.lastCheck)}.`
          : "Not checked yet."

  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm">
        This is version <strong className="mono">{u.current}</strong>.{" "}
        {u.kind === "source" ? "It runs from the source folder." : null}
      </p>
      <p className="m-0 text-sm" aria-live="polite">
        {status}
      </p>
      {!u.canInstall && u.why ? <p className="m-0 text-xs text-mut">{u.why}</p> : null}
      {u.available && target && u.latest?.notes ? (
        <ul className="m-0 max-h-32 overflow-auto pl-5 text-xs">
          {noteLines(u.latest.notes).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn"
          disabled={u.checking}
          onClick={() => void updateCall("POST", "/api/update/check")}
        >
          Check now
        </button>
        {u.available && u.canInstall && target ? (
          <button
            className="btn btn-primary"
            disabled={u.phase === "preparing" || u.phase === "applying"}
            onClick={() =>
              void updateCall(
                "POST",
                u.phase === "ready" && u.ready === target
                  ? "/api/update/apply"
                  : "/api/update/prepare",
                { version: target },
              )
            }
          >
            {u.phase === "ready" && u.ready === target
              ? `Restart into ${target}`
              : u.phase === "preparing"
                ? `Downloading ${target}`
                : `Download ${target}`}
          </button>
        ) : null}
      </div>
      {u.phase === "failed" && u.error ? (
        <p className="m-0 text-sm font-semibold" role="alert">
          {u.error}
        </p>
      ) : null}

      <label htmlFor={intervalId} className="grid gap-1 text-sm">
        Look for a new version
        <select
          id={intervalId}
          className="field"
          value={u.settings.checkEveryMinutes}
          onChange={(e) =>
            void updateCall("PUT", "/api/update/settings", {
              checkEveryMinutes: Number(e.target.value),
            })
          }
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={u.settings.downloadInBackground}
          onChange={(e) =>
            void updateCall("PUT", "/api/update/settings", {
              downloadInBackground: e.target.checked,
            })
          }
        />
        Download a new version as soon as it is found, so Update is quick. Nothing changes until you
        choose Update.
      </label>

      {u.settings.skipped.length ? (
        <div className="grid gap-1">
          <span className="text-sm">Skipped versions</span>
          <ul className="m-0 grid list-none gap-1 p-0">
            {u.settings.skipped.map((v) => (
              <li key={v} className="flex items-center gap-2 text-sm">
                <span className="mono">{v}</span>
                <button
                  className="btn"
                  onClick={() => void updateCall("POST", "/api/update/unskip", { version: v })}
                >
                  Offer {v} again
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {u.previous && u.canInstall ? (
        <div className="grid gap-1">
          <span className="text-sm">
            Version <span className="mono">{u.previous}</span> is kept beside this one, so you can
            go back to it.
          </span>
          {confirmBack ? (
            <span
              role="group"
              aria-label="Confirm going back"
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              JCVC closes, switches to {u.previous} and opens again. {u.current} is then skipped.
              <button
                className="btn btn-primary"
                onClick={() => void updateCall("POST", "/api/update/rollback")}
              >
                Go back to {u.previous}
              </button>
              <button className="btn" onClick={() => setConfirmBack(false)} autoFocus>
                Cancel
              </button>
            </span>
          ) : (
            <div>
              <button className="btn" onClick={() => setConfirmBack(true)}>
                Go back to {u.previous}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-1">
        <label htmlFor={tokenId} className="text-sm">
          GitHub token, only while the JCVC repository is private
        </label>
        <p className="m-0 text-xs text-mut">
          A fine-grained token with read access to the repository's contents. It is kept encrypted
          for your Windows account and only sent to GitHub's API.{" "}
          {u.tokenSet ? "A token is saved." : "No token is saved."}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            id={tokenId}
            className="field min-w-0 flex-1"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_..."
          />
          <button
            className="btn"
            disabled={!token.trim()}
            onClick={async () => {
              if (await updateCall("PUT", "/api/update/token", { token: token.trim() }))
                setToken("")
            }}
          >
            Save token
          </button>
          {u.tokenSet ? (
            <button className="btn" onClick={() => void updateCall("DELETE", "/api/update/token")}>
              Remove token
            </button>
          ) : null}
        </div>
      </div>
      <p className="m-0 text-xs text-mut">
        Updates come from <span className="mono">{u.where.replace(/^https:\/\//, "")}</span>. Each
        one is checked against JCVC's release signature before anything is used.
      </p>
    </div>
  )
}
