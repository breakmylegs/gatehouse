import fs from "node:fs"
import path from "node:path"

/**
 * Mac fork: where the Relay keeps its data on a Mac. Upstream's default away from Windows is ~/.gatehouse-relay; a
 * Mac keeps it with the rest of Codehouse's, in ~/Library/Application Support/Gatehouse/relay, which is where
 * Codehouse keeps its own Relay's (Devices, Run the Relay here) and where docs/mac.md says it is. A
 * ~/.gatehouse-relay from an earlier run is kept, so a phone paired with it stays paired. config.ts calls this.
 */
export function macRelayDir(
  home: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "darwin") return undefined
  const earlier = path.join(home, ".gatehouse-relay")
  if (fs.existsSync(earlier)) return earlier
  return path.join(home, "Library", "Application Support", "Gatehouse", "relay")
}
