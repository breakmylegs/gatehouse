import { useEffect, useState } from "react"
import { api } from "./api"

/** B19: a model on this computer is used only after you have seen its licence; that you did is kept here. */
const KEY = (model: string) => `gatehouse.licence.${model}`

export const licenceAccepted = (model: string): boolean => {
  try {
    return localStorage.getItem(KEY(model)) === "1"
  } catch {
    return false
  }
}

export const acceptLicence = (model: string): void => {
  try {
    localStorage.setItem(KEY(model), "1")
  } catch {
    // storage blocked: asked again next time
  }
}

/** A model's licence from the runtime: undefined while it is read, null when the runtime has none to show. */
export function useLicence(model: string | undefined): string | null | undefined {
  const [text, setText] = useState<string | null>()
  useEffect(() => {
    setText(undefined)
    if (!model) return
    let gone = false
    void api<{ licence: string | null }>(
      "GET",
      `/api/providers/licence?model=${encodeURIComponent(model)}`,
    ).then((r) => {
      if (!gone) setText(r.ok && r.data ? r.data.licence : null)
    })
    return () => {
      gone = true
    }
  }, [model])
  return text
}
