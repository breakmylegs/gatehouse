# The Codehouse visual identity

The owner supplied the Codehouse visual identity pack on 2 Nov 2026 (`codehouse-visual-identity.zip`): original artwork with no people, real brands, film imagery or third-party marks (invariant 16). The app uses the pack's files as they are. Nothing in the build draws or changes them.

| Pack folder | Where it is in the repository | Used for |
|---|---|---|
| `app-icons/` (16 to 256) | `packaging/brand/codehouse-icon-*.png` | The icon of Codehouse.exe, Codehouse-Console.exe, Codehouse-Update.exe and the installer, built into one .ico by `scripts/ico.mjs` |
| `app-icons/codehouse-icon.svg`, `-32.png` | `apps/web/public/favicon.svg`, `favicon-32.png` | The page icon |
| `app-icons/codehouse-icon-1024.png` | `docs/brand/` | For the README and anything printed |
| `tray-icons/` | `packaging/brand/tray-*.png`, copied next to the exe | The tray icon; the attention version while a decision waits, back to normal when the window is opened |
| `phone-icons/` | `apps/phone/public/` | The phone app's home-screen, maskable and Apple touch icons |
| (owner, 2 Nov, made with ChatGPT) | `apps/web/public/codehouse/splash.png`, `start-screen.png` | The start screen: the native start-up window (splash.png), the page before it loads, and Home (start-screen.png). It replaces the pack's flat `splash/` pictures. |
| `backgrounds/` | Not used | The faint scenes behind every screen were taken out on 4 Nov 2026 (owner: the app looks cleaner without them) |
| `empty-states/` (600 x 450) | `apps/web/public/codehouse/empty/` | The picture above an empty page or list (`components/EmptyState.tsx`) |
| `interface-icons/interface-icons-sprite.svg` | `apps/web/public/codehouse/icons.svg` | Every interface icon (`components/Icon.tsx`) |
| `wordmarks/` | `apps/web/public/codehouse/brand/` | Kept with the app for the places a wordmark is wanted |
| `installer/installer-side.png`, `installer-small.png` | `packaging/brand/` | The setup wizard's artwork (`packaging/installer.iss`) |
| `installer/social-preview.png` | `docs/brand/` | The GitHub social preview. GitHub only takes it in the repository's settings page, so it is on the owner's to-do list |
| `docs/palette.json` | `docs/brand/palette.json` | The colours, for reference |
| `interface-icons/interface-icons-preview.png` | `docs/brand/` | The labelled sheet of every icon |

The pack's legacy 480 x 360 spot pictures, single interface SVGs (the same drawings as the sprite) and its own manifest are not copied.
