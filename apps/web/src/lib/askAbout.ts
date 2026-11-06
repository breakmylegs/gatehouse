import { setRailMode } from "./railMode"
import { useStore } from "../store"

/** Ask about this session... (owner, 6 Nov): the new question page, with this code session chosen. */
export function askAbout(sessionId: string): void {
  useStore.setState({ newChatAbout: sessionId })
  setRailMode("chat")
  useStore.getState().setRoute("chat")
}
