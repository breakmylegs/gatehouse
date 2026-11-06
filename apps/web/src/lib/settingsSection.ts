import { useStore } from "../store"

/** Where Settings keeps the section last open, so it opens there again. */
export const SECTION_KEY = "gatehouse.settings.section"

/** Opens Settings at one of its sections, for a link from elsewhere ("Bring in your chats from claude.ai"). */
export function openSettingsAt(section: string): void {
  try {
    localStorage.setItem(SECTION_KEY, section)
  } catch {
    // storage blocked: Settings opens where it was
  }
  useStore.getState().setRoute("settings")
}
