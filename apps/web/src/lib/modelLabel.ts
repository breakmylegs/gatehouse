/**
 * A model's id as people say it: "claude-opus-5-5" is Opus 5.5, with any date or context suffix left off. A model on
 * this computer (an Ollama name such as qwen3:8b) is shown as it is.
 */
export function modelLabel(id: string | undefined): string | undefined {
  if (!id) return undefined
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?![\d])/i.exec(id)
  if (!m) return id.slice(0, 40)
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  return `${family} ${m[2]}${m[3] && m[3].length <= 2 ? `.${m[3]}` : ""}`
}
