import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { send } from "../store"

/**
 * D-007: the project's locked tests, on the desktop only. A locked test is changed, renamed or deleted by a session
 * only with you, even in Extreme approval. Lock one here or from Changes; unlocking is yours and is recorded.
 */

interface State {
  files: Array<{ path: string; changed: boolean; missing: boolean }>
  tampered: boolean
}

export function LocksPanel({ session }: { session: SessionInfo }) {
  const [st, setSt] = useState<State>()
  const [path, setPath] = useState("")
  const load = () =>
    void send({ type: "locks_state", sessionId: session.id }).then((r) => {
      if (r.ok && r.data) setSt(r.data as State)
    })
  useEffect(load, [session.id, session.state])
  const act = (cmd: Parameters<typeof send>[0], done: string) =>
    void send(cmd).then((r) => {
      if (!r.ok) toast.error(r.error?.message ?? "It was not changed")
      else {
        toast(done)
        setSt(r.data as State)
      }
    })
  return (
    <section aria-labelledby={`lk-${session.id}`}>
      <h3 id={`lk-${session.id}`} className="m-0 mb-1.5 text-[14px]">
        Locked tests
      </h3>
      {st?.tampered ? (
        <p role="alert" className="m-0 mb-1.5 text-[13px] text-sev">
          The lock file was changed outside Codehouse, so every test in this project counts as
          locked until you accept it again.
        </p>
      ) : null}
      {st?.files.length ? (
        <ul className="m-0 grid gap-1 p-0 text-[13px]">
          {st.files.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-2" style={{ listStyle: "none" }}>
              <span className="mono min-w-0 truncate">
                {f.path}
                {f.missing ? <span className="text-sev"> (missing)</span> : f.changed ? <span className="text-warn"> (changed outside Codehouse)</span> : null}
              </span>
              <button
                type="button"
                className="btn !min-h-6 !text-[12px]"
                onClick={() => act({ type: "unlock_test", sessionId: session.id, path: f.path }, `${f.path} unlocked`)}
              >
                Unlock
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-mut">
          {st ? "None. Lock a test here, or with Lock in Changes." : "..."}
        </p>
      )}
      {st && (st.tampered || st.files.some((f) => f.changed || f.missing)) ? (
        <button
          type="button"
          className="btn mt-1.5 !min-h-7 !text-[13px]"
          onClick={() => act({ type: "locks_accept", cwd: session.cwd }, "Locked tests accepted as they now are")}
        >
          Accept them as they now are
        </button>
      ) : null}
      <div className="mt-1.5 flex gap-2">
        <input
          className="field mono min-w-0 flex-1 !min-h-7 text-[13px]"
          placeholder="tests/acceptance.test.ts"
          aria-label="A test file to lock, from the project's folder"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button
          type="button"
          className="btn !min-h-7 !text-[13px]"
          disabled={!path.trim()}
          onClick={() => {
            act({ type: "lock_test", sessionId: session.id, path: path.trim() }, `${path.trim()} locked`)
            setPath("")
          }}
        >
          Lock
        </button>
      </div>
    </section>
  )
}
