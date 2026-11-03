# Pictures to make with ChatGPT

The visual identity pack's own pictures are flat drawings. Only the start screen (`apps/web/public/codehouse/start-screen.png`, made with ChatGPT on 2 Nov) has the look the owner wants. These prompts ask ChatGPT for the rest in the same look, one picture at a time, with the file name each one will have in the app.

## How to use them

1. Open a new ChatGPT conversation and attach `start-screen.png` (from this repository, or the Codehouse install's `app\web\codehouse` folder).
2. Paste the **style** block below first, then one prompt at a time. Download each picture and name it as shown.
3. Put the pictures in one folder, zip it and attach the zip in Codehouse. Codehouse resizes and compresses them; ChatGPT's own sizes are fine.

Leave out anything you do not want. The app keeps the flat picture for any that are missing.

## Style (paste first)

```
I am making pictures for a desktop app called Codehouse. The attached image is its start screen and sets the style for everything I will ask for: a photoreal, cinematic roadhouse at night, weathered wooden boards, warm amber lamp light, cyan and magenta neon, wet ground with coloured reflections, a moonlit sky with soft cloud, shallow depth of field, rich but not cluttered.

For every picture I ask for:
- Match that style, lighting and colour palette exactly.
- No people, faces, hands or animals. No real brands, logos, film references or film characters. No readable text unless I ask for it.
- Leave calm, darker areas where the app will put its own words, as I describe each time.
- Make one picture per reply, at the size I give.
Reply "Ready" and wait for my first request.
```

## 1. Backgrounds (behind every page, faint)

Wide pictures, 1536 x 1024 (landscape). The app shows them faintly behind its pages, so the middle and left should be calm and fairly dark, with the detail toward the edges.

| File | Prompt |
|---|---|
| `scene-neon-sign.png` | The roadhouse's big neon sign seen from below at an angle, glowing cyan and magenta against the night sky, no readable letters (the tubes out of focus). Calm dark sky over the left two thirds. |
| `scene-front.png` | The front porch of the roadhouse straight on, the saloon doors closed, lamps lit either side, empty wooden boardwalk. Keep the centre soft and dim. |
| `scene-porch.png` | Close on the porch boards and a rocking chair under a hanging amber lamp, a barrel and a fern in the corner, rain-wet boards catching neon. Detail on the right, dark on the left. |
| `scene-bar.png` | Inside the roadhouse: a long wooden bar counter with stools, shelves of unlabelled bottles behind, pendant lamps, a neon glow on the back wall, nobody there. Detail on the right, dim on the left. |
| `scene-jukebox.png` | An old jukebox glowing magenta and cyan in a dark corner of the roadhouse, its light spilling across a wooden floor. Jukebox to the right, dark space to the left. |
| `scene-car-park.png` | The gravel car park outside at night, one parked classic pickup truck, puddles with neon reflections, the roadhouse's lit windows in the distance on the right. |
| `scene-lot.png` | A wider view of the empty lot and the roadhouse far off, a single tall light pole, wet ground, mist low over the ground. Lots of dark sky. |
| `scene-highway.png` | A two-lane desert highway at night leading to the roadhouse glowing on the horizon, the centre line wet and shining, stars and moonlit cloud above. |
| `scene-dawn.png` | The same roadhouse at first light: neon still on but fading, a pale blue and pink sky, mist over the car park, lamps still warm. |

### Light versions (for the light theme, optional)

Same names with `-light` before `.png`, 1536 x 1024. Prompt for each: "The same view as `<file>` at late afternoon in soft daylight: warm sun, pale sky, the neon switched off, the colours muted and airy, so dark text reads on top of it." Make: `scene-neon-sign-light`, `scene-front-light`, `scene-porch-light`, `scene-bar-light`, `scene-car-park-light`, `scene-lot-light`, `scene-highway-light`.

## 2. Empty pages (small pictures above a line of text)

Square, 1024 x 1024, each one object or small scene in the middle with **a transparent background** (ask "with a transparent background, PNG"). If ChatGPT cannot do transparent, ask for a plain very dark background (#14101c) instead.

| File | Shown when | Prompt |
|---|---|---|
| `all-done.png` | Nothing needs you | A single glowing neon tick in cyan, mounted on a small piece of weathered wood, warm lamp light from above. |
| `empty-approvals.png` | No requests waiting | An empty wooden in-tray on a bar counter under a warm lamp, a neon glow behind. |
| `empty-chats.png` | No chats yet | A neon speech bubble with three dots, cyan, glowing on a dark wooden panel. |
| `empty-sessions.png` | No sessions yet | A single empty bar stool under a hanging amber lamp, a soft pool of light on the floor. |
| `empty-projects.png` | No projects yet | A neat stack of three wooden crates with a cyan neon strip along the top one. |
| `empty-memory.png` | Nothing remembered | A small wooden recipe box with index cards, one card glowing faintly magenta. |
| `empty-marketplace.png` | Nothing in the marketplace | A small roadside market stall with an empty wooden shelf and a little neon "open" light, no letters. |
| `empty-search.png` | No results | A vintage brass magnifying glass on a bar counter catching neon reflections. |
| `offline.png` | No connection | An old radio on a wooden shelf, its dial dark, a single amber lamp, a tangled unplugged cable. |

## 3. The name (wordmarks)

| File | Size | Prompt |
|---|---|---|
| `wordmark-dark.png` | 1536 x 384 | The neon "Codehouse" sign from the attached image on its own: the same cyan script letters with the magenta underline and the small `</>` above, glowing, on a transparent background. Spell it exactly C-o-d-e-h-o-u-s-e. |
| `wordmark-light.png` | 1536 x 384 | The same "Codehouse" sign as a painted wooden sign in daylight: dark teal script on pale weathered wood, magenta underline, on a transparent background. Spell it exactly C-o-d-e-h-o-u-s-e. |
| `wordmark-stacked.png` | 1024 x 1024 | The `</>` neon mark above the word "Codehouse" in the same neon script, centred, on a transparent background. |

## 4. The app's own icon (taskbar, title bar, installer)

| File | Size | Prompt |
|---|---|---|
| `app-icon.png` | 1024 x 1024 | An app icon: a rounded square of dark night sky with the roadhouse's roof line in warm wood and a glowing cyan and magenta `</>` neon above it. Bold and simple so it still reads at 16 pixels. No other text. |
| `installer-side.png` | 1024 x 1960 (tall) | A tall picture of the roadhouse's neon sign and porch at night, the sign near the top, dark at the bottom. No readable text. |

## What stays drawn in code

The small icons in the sidebar and buttons (`icons.svg`) stay as drawn outlines from the pack. They are 16 pixels high, have to change colour with the theme and the state, and must stay sharp at any size, which a generated picture cannot do. If you want different ones, describe what you want changed and they are drawn to match.
