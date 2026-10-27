/** Calls to the Host's admin endpoints. The per-launch token travels as a bearer header, never in a URL. */
export interface ApiResult<T> {
  ok: boolean
  status: number
  data?: T
  error?: string
  errors?: string[]
}

export async function api<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const token = sessionStorage.getItem("gatehouse.token") ?? ""
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    return { ok: false, status: 0, error: "Could not reach the Host. Is Gatehouse still running?" }
  }
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    // A reply that is not JSON (a proxy page, an edge block) must say what it was, not fail silently.
    return {
      ok: false,
      status: res.status,
      error: `The Host answered ${res.status} with something that was not JSON.`,
    }
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; errors?: string[] }
    return {
      ok: false,
      status: res.status,
      error: j.error ?? `The Host answered ${res.status}.`,
      ...(j.errors ? { errors: j.errors } : {}),
    }
  }
  return { ok: true, status: res.status, data: json as T }
}

export async function download(url: string, filename: string): Promise<string | undefined> {
  const token = sessionStorage.getItem("gatehouse.token") ?? ""
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) return `The Host answered ${res.status}.`
  const blob = await res.blob()
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return undefined
}
