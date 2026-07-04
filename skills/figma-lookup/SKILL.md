# Figma Design Skill

Use this skill whenever the user gives a Figma URL — whether they ask to **inspect** spacing/layout or to **implement** the UI in code.

**Usage:**
- `/figma-lookup <figma-url>` — inspect layout, padding, spacing
- `/figma-lookup <figma-url> implement` — implement the UI from the design

---

## Step 1 — Resolve the exports directory

Read `~/.figma-export.json`. Use the `exportsDir` value if present, otherwise default to `~/figma-exports`.

## Step 2 — Parse the URL

From the Figma URL extract:
- `<file_key>` — path segment after `/design/`
- `<node-id>` — `node-id` query param value (e.g. `16582-97406`); keep `-` as-is

## Step 3 — Find the node

1. Try `<exportsDir>/<file_key>/views/<node-id>.json` directly.
2. If missing, open `<exportsDir>/<file_key>/node-index.json`, look up `<node-id>` to get the containing view file id, then read `<exportsDir>/<file_key>/views/<containing-id>.json` and walk the `tree` recursively until `node.id.replace(/:/g, '-') === '<node-id>'`.
3. If neither file exists, tell the user to run the **"Design Export for AI Agents"** Figma plugin on the file and re-export, then retry.

Also load these files from `<exportsDir>/<file_key>/`:
- `views/<view-id>.png` — screenshot of the view (if present). **Read this image before implementing** — it shows what the design actually looks like; the JSON gives the exact values.
- `tokens.json` — design tokens (colors, spacing, radius, typography) per mode
- `components.json` — component definitions referenced by the view
- `components/<component-id>.png` — natural-size screenshot of each component (if present). Use these when implementing an `INSTANCE` — the view screenshot is downscaled, so small components (icons, buttons) are only legible here. Also use them as the reference image in the asset-matching pipeline (Step 4B).
- `styles.json` — color/text/effect styles
- `<exportsDir>/code-maps/<file_key>.json` — accumulated Figma-component → project-code mappings (note: sibling of the export folder, NOT inside it; may not exist yet; see Step 4B)

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

**Code map — check first, grow as you go.** `<exportsDir>/code-maps/<file_key>.json` maps Figma components to this project's code. It lives **next to** the per-file export folder (not inside it) so that replacing the folder on re-export never deletes it. It is owned by the skill, never written by the export plugin.

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

Then generate code:

- **Spacing:** use `layout.itemSpacing` + `layout.padding` for auto-layout frames; for free-layout frames derive gaps from `box` coordinates (see above).
- **Tokens:** prefer token names (`color.token`, `font.token`) over raw hex/numbers — they map to the project's design system.
- **Components:** `INSTANCE` nodes reference a component in `components.json` via `componentId`. Apply their `props` (variants) and `overrides` (actual text content) on top of the base component.
- **Assets:** for every node with an `asset` field, check whether the icon/image already exists in the project before copying the export in. **Exception — view-root assets:** if the node carrying the `asset` is the view root itself (or is view-sized), that file is a full-screen handoff render (designers often mark whole screens for export). Treat it as a reference screenshot only — never embed it in the implementation, and skip the matching pipeline for it. Names are unreliable (export filenames get `-1`/`-2` suffixes; projects rename assets) and byte hashes break under re-encoding (SVGO, Xcode asset catalogs, PDF metadata churn) — so the real decision is made by **dimensions + visual comparison**:

  0. **Fast path — exact hash.** `md5 -q` the exported asset (`<exportsDir>/<file_key>/assets/<file>`); hash project files of the same extension; identical bytes → reuse that project file immediately. Expect this to miss often; that's fine.

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
     - No match → reference `<exportsDir>/<file_key>/assets/<file>` and tell the user to copy it into the project
     - Export file missing too → leave a `TODO` comment with the Figma component name and dimensions. Never invent an asset name.
- **Framework:** map to the current project's framework (SwiftUI / React / Flutter / etc.), reusing existing components and tokens where they already exist in the codebase.
- Walk the tree section by section and implement incrementally, not all at once.
