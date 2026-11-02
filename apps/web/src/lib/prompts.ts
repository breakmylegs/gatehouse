/** A saved prompt, as the Host keeps it (W1-14). */
export interface SavedPrompt {
  id: string
  title: string
  text: string
  at: string
}

const VAR = /\{\{\s*([A-Za-z][\w -]{0,39}?)\s*\}\}/g

/** The {{variables}} in a prompt, each once, in the order they first appear. */
export function variablesOf(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR)) if (!out.includes(m[1]!)) out.push(m[1]!)
  return out
}

/** The prompt with each variable filled in. One left empty stays as it was, so you can see it. */
export function fillPrompt(text: string, values: Record<string, string>): string {
  return text.replace(VAR, (all, name: string) =>
    values[name]?.trim() ? values[name]!.trim() : all,
  )
}
