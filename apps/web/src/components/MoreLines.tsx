/**
 * The most lines of a diff drawn at first (backlog G11, docs/performance.md): a diff of thousands of lines would
 * otherwise put every one on the page at once and make the window slow. The rest come when asked for.
 */
export const LINE_LIMIT = 400

/** The lines to draw: all of them once asked for, otherwise the first LINE_LIMIT. */
export function shownLines<T>(lines: T[], all: boolean): T[] {
  return all || lines.length <= LINE_LIMIT ? lines : lines.slice(0, LINE_LIMIT)
}

/** Says how many lines are not drawn, with a button to draw them. Nothing when all are drawn. */
export function MoreLines({ total, all, onShow }: { total: number; all: boolean; onShow: () => void }) {
  if (all || total <= LINE_LIMIT) return null
  const rest = total - LINE_LIMIT
  return (
    <button type="button" className="pane-tool mx-2.5 my-1" onClick={onShow}>
      Show the other {rest === 1 ? "line" : `${rest.toLocaleString("en-GB")} lines`}
    </button>
  )
}
