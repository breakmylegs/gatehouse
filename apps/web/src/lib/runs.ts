/**
 * T-029: several runs of one prompt, each in its own worktree, each on the model you choose for it. A run with no
 * model chosen uses the form's model; when that is empty too, Claude Code's own default.
 */
export function runModels(runs: number, chosen: readonly string[], formModel: string): string[] {
  return Array.from({ length: runs }, (_, i) => chosen[i] || formModel)
}

/** What the toast says when the runs start, in the foreground or in the background. */
export function runsStarted(models: readonly string[], background: boolean, label: (id: string) => string): string {
  const named = [...new Set(models.filter(Boolean))].map(label)
  const on = named.length > 1 ? ` on ${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : named.length ? ` on ${named[0]}` : ""
  return background
    ? `${models.length} runs started in the background${on}, each in its own worktree. They are in the sidebar; start something else here.`
    : `${models.length} runs started${on}, each in its own worktree. Keep the best when they are done.`
}
