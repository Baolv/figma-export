# Figma Design Skill

Use this skill whenever the user gives a Figma URL — whether they ask to **inspect** spacing/layout or to **implement** the UI in code.

**Usage:**
- `/figma-lookup <figma-url>` — inspect layout, padding, spacing
- `/figma-lookup <figma-url> implement` — implement the UI from the design

---

## Step 1 — Resolve the exports directory

Read `~/.figma-export.json`. Use the `exportsDir` value if present, otherwise default to `~/figma-exports`.

## Step 2 — Parse the URL

From the Figma URL (`https://www.figma.com/design/<file_key>/<file-name>?node-id=<id>`) extract:
- `<file_key>` — path segment after `/design/`
- `<file-name>` — the next path segment (e.g. `NC-Journey`)
- `<node-id>` — `node-id` query param value (e.g. `16582-97406`); keep `-` as-is

## Step 3 — Resolve the export folder, then find the node

**3a. Resolve the export folder.** Figma restricts the real file key to private plugins, so the export folder is usually named by a slug of the file *name*, not the key from the URL. Try in order:

1. `<exportsDir>/<file_key>/` (works for private-plugin exports)
2. `<exportsDir>/<slug>/` where `<slug>` = `<file-name>` lowercased with every non-alphanumeric run replaced by `-` (trimmed, max 40 chars). E.g. `NC-Journey` → `nc-journey`. This matches the plugin's own fallback naming.
3. Scan `<exportsDir>/*/meta.json` and compare each `fileName` to `<file-name>` case-insensitively, ignoring punctuation. A single match wins.

Call the resolved folder `<folder>` and use it everywhere `<file_key>` appears below (including the code-map filename: `code-maps/<folder-name>.json`).

**3b. Find the node.**

1. Try `<folder>/views/<node-id>.json` directly.
2. If missing, open `<folder>/node-index.json`, look up `<node-id>` to get the containing view file id, then read `<folder>/views/<containing-id>.json` and walk the `tree` recursively until `node.id.replace(/:/g, '-') === '<node-id>'`.
3. Only if no folder resolved in 3a, or the node is in none of the above: tell the user to run the **"Design Export for AI Agents"** Figma plugin on the file and re-export, then retry.

Also load these files from `<folder>/`:
- `views/<view-id>.png` — screenshot of the view (if present). **Read this image before implementing** — it shows what the design actually looks like; the JSON gives the exact values.
- `tokens.json` — design tokens (colors, spacing, radius, typography) per mode
- `components.json` — component definitions referenced by the view
- `components/<component-id>.png` — natural-size screenshot of each component (if present). Use these when implementing an `INSTANCE` — the view screenshot is downscaled, so small components (icons, buttons) are only legible here. Also use them as the reference image in the asset-matching pipeline (Step 4B).
- `styles.json` — color/text/effect styles
- `<exportsDir>/code-maps/<folder-name>.json` — accumulated Figma-component → project-code mappings (note: sibling of the export folder, NOT inside it; may not exist yet; see Step 4B)

**Staleness check:** read `exportedAt` from `meta.json`. If it is more than 14 days old (or missing), warn the user: "This export is N days old — the design may have changed. Consider re-exporting." Then continue normally.

## Step 4A — If inspecting layout/spacing

For the matched node and its parent:

**Auto-layout** (`layout.mode === "HORIZONTAL" | "VERTICAL"`):
- Padding: `layout.padding` → `{ t, r, b, l }` px
- Gap between children: `layout.itemSpacing` px

**Free-layout** (`layout.mode === "NONE"` or absent):
- Compute from `box` coordinates:
  - left = `node.box.x - parent.box.x`
  - right = `(parent.box.x + parent.box.w) - (node.box.x + node.box.w)`
  - top = `node.box.y - parent.box.y`
  - bottom = `(parent.box.y + parent.box.h) - (node.box.y + node.box.h)`

Report: node name, type, size (`box.w × box.h`), its own layout, its padding relative to parent, and parent layout mode.

## Step 4B — If implementing the UI

Look at the view screenshot (`views/<view-id>.png`) first for visual context, then use the design tree for exact values.

**Device chrome — detect and skip.** Figma designs for mobile screens embed fake OS UI so the designer can see the full screen in context. These nodes are NOT app code — the OS/platform owns them. When walking the tree, detect them by node name or component name and replace with the platform-appropriate handling instead of rendering them:

| Pattern (name or component contains) | What it is | Replace with |
|---|---|---|
| `Bars/Status/`, `status bar`, `Status Bar` | iOS/Android status bar | iOS: `.toolbarColorScheme()` / `UIStatusBarStyle`; Android: `WindowCompat` + `statusBarColor`; RN: `<StatusBar>`; Web: omit entirely |
| `home indicator`, `Home Indicator` | iOS bottom swipe area | Use `safeAreaInsets.bottom` padding in the containing scroll view |
| `Bars/Navigation/`, `navigation bar` (when it is OS-style, full-width, 44-64px tall) | System nav bar | Handled by the navigator (`NavigationView`, `Scaffold`, `AppBar`, etc.) |
| `Bars/Tab/`, `tab bar` (full-width, ~49-83px, pinned to bottom) | System tab bar | Handled by the tab navigator (`TabView`, `BottomNavigationBar`, etc.) |
| `keyboard`, `Keyboard` | Software keyboard mockup | Omit — handled by OS; set `resizeToAvoidBottomInset` or equivalent |
| `Dynamic Island`, `Notch`, `Camera` | Hardware chrome | Omit — handled by `safeAreaInsets.top` |

Rules:
- A node matches if its `name` or `component` field contains the pattern (case-insensitive).
- Only skip nodes that are **direct children of the root screen frame** (depth 1) or whose position is anchored to the very top or bottom of the frame. A "navigation bar" *inside* the app content (e.g., a custom toolbar) is app code — implement it normally.
- When skipping, emit a one-line comment in the output so the developer knows to configure it: `// Status bar: light-content (white icons on dark hero image)`

**Code map — check first, grow as you go.** `<exportsDir>/code-maps/<folder-name>.json` maps Figma components to this project's code. It lives **next to** the per-file export folder (not inside it) so that replacing the folder on re-export never deletes it. It is owned by the skill, never written by the export plugin.

Entries are keyed by the component's stable `key` (from `components.json`) — this survives renames in Figma. The `name` field is for human readability only:

```json
{
  "4c34c25c98afd31e17f70b3c27ef4e7684270d34": { "name": "checkbox", "path": "src/components/Checkbox.tsx" },
  "970105fb29df761323eab79528d9f701577f9304": { "name": "sign up/login icons", "path": "src/components/SocialLogin.tsx", "note": "template-tinted" }
}
```

- Before implementing any `INSTANCE` node: resolve its `componentId` → look up that component in `components.json` → take its `key` → check the code map. A hit means reuse that project file directly and skip the search/matching steps below.
- Whenever you confirm a new match (via the asset pipeline below, or by finding an existing project component for an INSTANCE), **append it to the code map** (create the `code-maps/` directory and file if missing). Every implementation makes the next one faster.
- If an entry's `path` no longer exists in the project, treat it as a miss and re-match (then update the entry).

**Typography — mandatory pre-code lookup.** Before writing any label, button, or text code, walk every TEXT node in the subtree and build this table. Do not skip this step — guessing or defaulting to a habitual style (e.g. "body") is a known recurring error.

| Text content (truncated) | `font.size` | `font.weight` | `font.token` (if present) | Project typography token |
|---|---|---|---|---|
| … | 14 | 400 | `ios.body-2.regular` | *(map from project design system)* |
| … | 24 | 700 | — | *(map from project design system)* |

Fill this table from the Figma JSON (`font.size` and `font.weight` on each TEXT node; `font.token` when the text is bound to a text style). Then map each row to the project's own typography tokens — check the project's design-system docs or token definitions if they exist. Only after the table is complete, write code. Never assume a size or weight from context or habit.

**Colors — mandatory pre-code lookup.** For every node that carries a color, build a table before writing code. **Where the color lives depends on the node type:**

- **TEXT nodes**: the text color is under the top-level **`color`** key (`color.token` / `color.hex`) — TEXT nodes in this export do NOT use `fills[]`. Reading only `fills` on a TEXT node yields "no color" and leads to guessing from the screenshot (a known real error: mid-grey body text misread as near-black).
- **Frames/shapes** (backgrounds, borders): read `fills[].token` / `fills[].hex` and `strokes[]`.

| Node / element | `color.token` (TEXT) / `fills[].token` (shapes) or hex | Project color token |
|---|---|---|
| … | `text.secondary` / `#666666` | *(map from project design system)* |

Prefer the token (`color.token` for TEXT, `fills[].token` for shapes) and map it to the project's color tokens; fall back to the `hex` only if the token is missing. If neither exists on the node, say so explicitly and ask rather than guessing from the screenshot. Never hard-code hex strings when the project has a token system. Do not write any color value in code until the table is complete.

**Corner radius on INSTANCE nodes.** Exports made with plugin ≥ 1.3 include `cornerRadius` (plus `fills`, `strokes`, `effects`) directly on INSTANCE nodes, capturing designer overrides — use those values. **Older exports never carry these fields on instances.** For an older export (check `meta.json`'s `exportedAt`, or simply the field being absent), determine an instance's real radius like this:

1. Read the component default from `components.json` — valid only if the instance's `props` variant matches the exported variant, and blind to local overrides.
2. **Cross-check the view screenshot** (`views/<id>.png`) or the component screenshot: radius 2 vs 8 is clearly visible at button/field size. **If the JSON default and the screenshot disagree, the screenshot wins.**
3. When still ambiguous, ask the user for a Figma-inspector screenshot of the selected instance rather than guessing.

Then generate code:

- **Spacing:** use `layout.itemSpacing` + `layout.padding` for auto-layout frames; for free-layout frames derive gaps from `box` coordinates (see above).
- **Tokens:** prefer token names (`color.token`, `font.token`) over raw hex/numbers — they map to the project's design system. Use the typography and color tables built above; never a raw value where a token exists.
- **Components:** `INSTANCE` nodes reference a component in `components.json` via `componentId`. Apply their `props` (variants) and `overrides` (actual text content) on top of the base component.
- **Assets:** for every node with an `asset` field, check whether the icon/image already exists in the project before copying the export in. **Exception — view-root assets:** if the node carrying the `asset` is the view root itself (or is view-sized), that file is a full-screen handoff render (designers often mark whole screens for export). Treat it as a reference screenshot only — never embed it in the implementation, and skip the matching pipeline for it. Names are unreliable (export filenames get `-1`/`-2` suffixes; projects rename assets) and byte hashes break under re-encoding (SVGO, Xcode asset catalogs, PDF metadata churn) — so the real decision is made by **dimensions + visual comparison**:

  0. **Fast path — exact hash.** `md5 -q` the exported asset (`<folder>/assets/<file>`); hash project files of the same extension; identical bytes → reuse that project file immediately. Expect this to miss often; that's fine.

  1. **Inventory project assets** (detect platform from project structure):
     - iOS: `find . -name "*.imageset" -type d` inside `*.xcassets` (PDF, PNG @1x/2x/3x); read each imageset's `Contents.json` for filenames/scales
     - Android: `res/drawable*/` VectorDrawable XMLs (`ic_*.xml`) and `res/mipmap-*dpi/` PNG/WebP (mdpi=1x, hdpi=1.5x, xhdpi=2x, xxhdpi=3x, xxxhdpi=4x)
     - Web: `*.svg`, `*.png`, `*.webp` under `src/`, `assets/`, `public/`, `icons/`
     - Flutter: `assets/` plus entries declared in `pubspec.yaml`

  2. **Filter candidates by dimensions.** The node's `box.w × box.h` is the rendered size (e.g. 24×24):
     - PNG/PDF: `sips -g pixelWidth -g pixelHeight <file>` (macOS); ImageMagick `identify` on Linux
     - SVG: read `width`/`height`/`viewBox` from the file text
     - Android VectorDrawable: read `android:viewportWidth`/`viewportHeight` and `android:width`/`height`
     - Accept exact match and density multiples (1.5x/2x/3x/4x); allow small tolerance for fractional PDF sizes

  3. **Rank by name similarity.** Figma `component` name (e.g. `icon/close`) vs candidate name (`ic_close`, `CloseIcon`). Ranking signal only — never a requirement, never a disqualifier.

  4. **Visual confirmation — the real decision.** For the top 1–3 candidates:
     - Convert non-PNG files to PNG in a scratch dir, using whichever tool exists: `sips -s format png <file> --out <out>.png` (macOS, handles PDF) → ImageMagick `magick`/`convert` → `pdftoppm` (PDF) / `rsvg-convert` (SVG) on Linux; `qlmanage -t -s 128 <file> -o <dir>` for SVG on macOS
     - Convert the Figma export the same way if needed
     - **Read both images and compare them visually.** Same glyph/shape → match, even if the color differs (note it's likely a template/tinted image). Different shape → reject.
     - Android VectorDrawable: no easy CLI rendering — instead compare the drawable's `pathData` against the exported SVG's `<path d="...">` (same command sequence ≈ same icon), combined with the dimension match from step 2

  5. **Decide:**
     - Match → use the project's existing asset/imageset/component; do not copy the export
     - No match → reference `<folder>/assets/<file>` and tell the user to copy it into the project
     - Export file missing too → leave a `TODO` comment with the Figma component name and dimensions. Never invent an asset name.
- **Framework:** map to the current project's framework (SwiftUI / React / Flutter / etc.), reusing existing components and tokens where they already exist in the codebase.
- Walk the tree section by section and implement incrementally, not all at once.
