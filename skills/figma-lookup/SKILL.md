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
- `tokens.json` — design tokens (colors, spacing, radius, typography) per mode
- `components.json` — component definitions referenced by the view
- `styles.json` — color/text/effect styles

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

Use the loaded design tree to generate code:

- **Spacing:** use `layout.itemSpacing` + `layout.padding` for auto-layout frames; for free-layout frames derive gaps from `box` coordinates (see above).
- **Tokens:** prefer token names (`color.token`, `font.token`) over raw hex/numbers — they map to the project's design system.
- **Components:** `INSTANCE` nodes reference a component in `components.json` via `componentId`. Apply their `props` (variants) and `overrides` (actual text content) on top of the base component.
- **Assets:** nodes with an `asset` or `assets` field reference files in `<exportsDir>/<file_key>/assets/` — use the real asset paths, never invent icons or images.
- **Framework:** map to the current project's framework (SwiftUI / React / Flutter / etc.), reusing existing components and tokens where they already exist in the codebase.
- Walk the tree section by section and implement incrementally, not all at once.
