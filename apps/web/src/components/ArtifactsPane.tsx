import { diffLines } from "diff"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "../lib/api"
import { download } from "../lib/exportMarkdown"
import { offlineExport } from "../lib/artifactExport"
import Markdown from "react-markdown"
import { LINK_PARTS } from "../lib/links"
import remarkGfm from "remark-gfm"
import { CodeView } from "./CodeViews"
import { useStore } from "../store"

interface Version {
  version: number
  bytes: number
  at: string
}
interface Artifact {
  id: string
  title: string
  kind: "html" | "svg" | "markdown" | "code" | "mermaid"
  versions: Version[]
}

/**
 * What a chat made to show you (owner's plan, W1-09, ADR 0003): each artifact with its versions, shown in a sandbox
 * that runs its own scripts and nothing else. Compare a version with the one before, or export it as a file.
 */
/** A document or code: shown as text with the app's own views, so nothing in it runs (CH-03). */
const asText = (kind: Artifact["kind"] | undefined) => kind === "markdown" || kind === "code"

/** T-058: the zoom steps, and one step in or out. */
export const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const
export function stepZoom(z: number, by: -1 | 1): number {
  const i = ZOOMS.findIndex((x) => Math.abs(x - z) < 0.001)
  const at = i < 0 ? ZOOMS.indexOf(1) : i
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + by))]!
}

/** T-058: an HTML artifact's address with the theme it is shown in. */
export const themedPath = (path: string, theme: string) => `${path}${path.includes("?") ? "&" : "?"}theme=${theme === "dark" ? "dark" : "light"}`

export function ArtifactsPane({ sessionId, refresh }: { sessionId: string; refresh: number }) {
  const [list, setList] = useState<Artifact[]>()
  const [chosen, setChosen] = useState<{ id: string; version: number }>()
  const [path, setPath] = useState<string>()
  // T-058: a page follows the theme, and can be zoomed (50% to 200%).
  const theme = useStore((s) => s.theme)
  const [zoom, setZoom] = useState(1)
  const [body, setBody] = useState<string>()
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

  const chosenKind = list?.find((a) => a.id === chosen?.id)?.kind
  useEffect(() => {
    setCompare(undefined)
    setBody(undefined)
    if (!chosen) return setPath(undefined)
    let gone = false
    if (asText(chosenKind)) {
      setPath(undefined)
      void api<{ content: string }>(
        "GET",
        `/api/artifacts/export?session=${encodeURIComponent(sessionId)}&artifact=${encodeURIComponent(chosen.id)}&version=${chosen.version}`,
      ).then((r) => {
        if (!gone && r.ok && r.data) setBody(r.data.content)
      })
      return () => {
        gone = true
      }
    }
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
  }, [sessionId, chosen, chosenKind])

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
                // B45: one file that works offline, under the same rules as here (no network).
                // C-057: a diagram is kept as its Mermaid source; a page that draws it offline would need Mermaid inside it.
                if (asText(artifact.kind) || artifact.kind === "mermaid")
                  return download(
                    got.name,
                    got.content,
                    artifact.kind === "markdown" ? "text/markdown" : artifact.kind === "mermaid" ? "text/vnd.mermaid" : "text/plain",
                  )
                download(
                  got.name,
                  offlineExport(artifact.kind as "html" | "svg", got.content),
                  artifact.kind === "svg" ? "image/svg+xml" : "text/html",
                )
              }}
            >
              {asText(artifact.kind) || artifact.kind === "mermaid" ? "Download" : "Export for offline use"}
            </button>
            {asText(artifact.kind) && body !== undefined ? (
              <button
                type="button"
                className="btn !min-h-7 !text-[13px]"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(body)
                    .then(() => toast.success("Copied", { id: "artifact" }))
                    .catch(() => toast.error("It could not be copied", { id: "artifact" }))
                }
              >
                Copy
              </button>
            ) : null}
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
          ) : asText(artifact.kind) ? (
            body === undefined ? (
              <p className="m-0 text-mut">Loading…</p>
            ) : artifact.kind === "markdown" ? (
              <div
                className="help-body max-h-[60vh] overflow-auto rounded-md border border-line px-4 py-3"
                aria-label={`Artifact: ${artifact.title}, version ${chosen.version}`}
              >
                <Markdown remarkPlugins={[remarkGfm]} components={LINK_PARTS}>{body}</Markdown>
              </div>
            ) : (
              <CodeView text={body} label={`${artifact.title}, version ${chosen.version}`} />
            )
          ) : path ? (
            <>
              <span className="flex items-center gap-1 text-[13px]" role="group" aria-label="Zoom">
                <button type="button" className="btn !min-h-7" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]!} onClick={() => setZoom((z) => stepZoom(z, -1))}>
                  -
                </button>
                <span className="w-12 text-center tabular-nums" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <button type="button" className="btn !min-h-7" aria-label="Zoom in" disabled={zoom >= ZOOMS.at(-1)!} onClick={() => setZoom((z) => stepZoom(z, 1))}>
                  +
                </button>
                {zoom !== 1 ? (
                  <button type="button" className="btn !min-h-7" onClick={() => setZoom(1)}>
                    Actual size
                  </button>
                ) : null}
              </span>
              {/* A sandbox: its own scripts and nothing else. The address carries the same rule in its headers. */}
              <div className="h-[60vh] w-full overflow-auto rounded-md border border-line">
                <iframe
                  title={`Artifact: ${artifact.title}, version ${chosen.version}`}
                  src={artifact.kind === "html" ? themedPath(path, theme) : path}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  className={artifact.kind === "html" ? "block border-0" : "block border-0 bg-white"}
                  style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
                />
              </div>
            </>
          ) : null}
          <p className="m-0 text-xs text-mut">
            {asText(artifact.kind)
              ? "Shown as text: nothing in it runs."
              : "It runs on its own: it cannot reach the internet, your files or Codehouse."}
          </p>
        </>
      ) : null}
    </div>
  )
}
