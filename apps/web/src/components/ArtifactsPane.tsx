import { diffLines } from "diff"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { download } from "../lib/exportMarkdown"

interface Version {
  version: number
  bytes: number
  at: string
}
interface Artifact {
  id: string
  title: string
  kind: "html" | "svg"
  versions: Version[]
}

/**
 * What a chat made to show you (owner's plan, W1-09, ADR 0003): each artifact with its versions, shown in a sandbox
 * that runs its own scripts and nothing else. Compare a version with the one before, or export it as a file.
 */
export function ArtifactsPane({ sessionId, refresh }: { sessionId: string; refresh: number }) {
  const [list, setList] = useState<Artifact[]>()
  const [chosen, setChosen] = useState<{ id: string; version: number }>()
  const [path, setPath] = useState<string>()
  const [compare, setCompare] =
    useState<Array<{ value: string; added?: boolean; removed?: boolean }>>()

  const load = useCallback(async () => {
    const r = await api<{ artifacts: Artifact[] }>(
      "GET",
      `/api/artifacts?session=${encodeURIComponent(sessionId)}`,
    )
    if (!r.ok || !r.data) return
    const got = r.data.artifacts
    setList(got)
    // A new version shows itself: the newest of the artifact you are on, or the newest artifact.
    setChosen((c) => {
      const keep = got.find((a) => a.id === c?.id) ?? got.at(-1)
      return keep ? { id: keep.id, version: keep.versions.at(-1)!.version } : undefined
    })
  }, [sessionId])
  useEffect(() => void load(), [load, refresh])

  useEffect(() => {
    setCompare(undefined)
    if (!chosen) return setPath(undefined)
    let gone = false
    void api<{ path: string }>("POST", "/api/artifacts/open", {
      session: sessionId,
      artifact: chosen.id,
      version: chosen.version,
    }).then((r) => {
      if (!gone && r.ok && r.data) setPath(r.data.path)
    })
    return () => {
      gone = true
    }
  }, [sessionId, chosen])

  const text = async (id: string, version: number) => {
    const r = await api<{ name: string; content: string }>(
      "GET",
      `/api/artifacts/export?session=${encodeURIComponent(sessionId)}&artifact=${encodeURIComponent(id)}&version=${version}`,
    )
    return r.ok ? r.data : undefined
  }

  if (list === undefined) return <p className="m-0 text-mut">Loading…</p>
  if (list.length === 0)
    return (
      <p className="m-0 text-mut">
        Nothing yet. Ask for a page, a chart or a small tool, and Claude shows it here.
      </p>
    )
  const artifact = list.find((a) => a.id === chosen?.id)
  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Artifacts">
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            className="btn !min-h-7 !text-[13px]"
            aria-pressed={a.id === chosen?.id}
            onClick={() => setChosen({ id: a.id, version: a.versions.at(-1)!.version })}
          >
            {a.title}
          </button>
        ))}
      </div>
      {artifact && chosen ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {/* B38 (EU AI Act Article 50): what Claude made says so where you see it, and inside the file. */}
            <span className="sign rounded border border-line px-1.5 text-[12px] text-mut">
              AI-generated
            </span>
            <label className="flex items-center gap-2 text-[13px]">
              <span className="text-mut">Version</span>
              <select
                className="field !min-h-7 !py-0"
                value={chosen.version}
                onChange={(e) => setChosen({ id: artifact.id, version: Number(e.target.value) })}
              >
                {artifact.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version} of {artifact.versions.length}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn !min-h-7 !text-[13px]"
              disabled={chosen.version <= artifact.versions[0]!.version}
              aria-pressed={compare !== undefined}
              onClick={async () => {
                if (compare) return setCompare(undefined)
                const before = artifact.versions.filter((v) => v.version < chosen.version).at(-1)
                if (!before) return
                const [a, b] = await Promise.all([
                  text(artifact.id, before.version),
                  text(artifact.id, chosen.version),
                ])
                if (a && b) setCompare(diffLines(a.content, b.content))
              }}
            >
              Compare with the one before
            </button>
            <button
              type="button"
              className="btn !min-h-7 !text-[13px]"
              onClick={async () => {
                const got = await text(artifact.id, chosen.version)
                if (!got) return toast.error("It could not be exported", { id: "artifact" })
                download(
                  got.name,
                  got.content,
                  artifact.kind === "svg" ? "image/svg+xml" : "text/html",
                )
              }}
            >
              Export
            </button>
          </div>
          {compare ? (
            <pre
              className="m-0 max-h-[60vh] overflow-auto rounded-md bg-s2 p-2 text-[12.5px]"
              aria-label="Changes from the version before"
            >
              {compare.map((part, i) => (
                <span
                  key={i}
                  className={
                    part.added ? "text-ok" : part.removed ? "text-sev line-through" : "text-mut"
                  }
                >
                  {part.value
                    .split("\n")
                    .filter((l, j, all) => l !== "" || j < all.length - 1)
                    .map((l) => `${part.added ? "+ " : part.removed ? "- " : "  "}${l}\n`)
                    .join("")}
                </span>
              ))}
            </pre>
          ) : path ? (
            // A sandbox: its own scripts and nothing else. The address carries the same rule in its headers.
            <iframe
              title={`Artifact: ${artifact.title}, version ${chosen.version}`}
              src={path}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="h-[60vh] w-full rounded-md border border-line bg-white"
            />
          ) : null}
          <p className="m-0 text-xs text-mut">
            It runs on its own: it cannot reach the internet, your files or Codehouse.
          </p>
        </>
      ) : null}
    </div>
  )
}
