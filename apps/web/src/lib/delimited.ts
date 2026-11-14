/** T-050 (t3code review, O31): CSV and TSV files shown as a table in the viewer. */
export const TABLE = /\.(csv|tsv)$/i

/** The most rows shown; the rest are counted, and Show the source has them all. */
export const MAX_ROWS = 1000

/**
 * The rows of a CSV (commas) or TSV (tabs) file. Quoted fields may hold the separator, line breaks and doubled
 * quotes, as RFC 4180 has them. Stops after `max` rows and says how many more there were.
 */
export function parseDelimited(
  text: string,
  sep: "," | "\t",
  max = MAX_ROWS,
): { rows: string[][]; more: number } {
  const rows: string[][] = []
  let more = 0
  let row: string[] = []
  let field = ""
  let quoted = false
  const endRow = () => {
    row.push(field)
    field = ""
    if (rows.length < max) rows.push(row)
    else more++
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === "") quoted = true
    else if (c === sep) {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      endRow()
    } else field += c
  }
  if (field !== "" || row.length) endRow()
  return { rows, more }
}

export const separatorOf = (rel: string): "," | "\t" => (/\.tsv$/i.test(rel) ? "\t" : ",")
