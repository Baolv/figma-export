<!--
Copy the block below into your global ~/.claude/CLAUDE.md (or a project CLAUDE.md).
It teaches Claude to read the exported design data whenever you paste a Figma URL.
-->

## Figma Export — configuration

Before reading any export data, determine the exports directory:
1. Try to read `~/.figma-export.json` → use the `exportsDir` value.
2. If the file does not exist or has no `exportsDir`, default to `~/figma-exports`.

This config file is per-user and never committed to git (it lives in `$HOME`).
To use a custom path, run once in your terminal:
```
echo '{"exportsDir":"/your/custom/path"}' > ~/.figma-export.json
```

---

## Implementing UI from a Figma URL or design name

> In the rules below, `<exportsDir>` means the resolved directory from the config above.

### When given a Figma URL (`https://www.figma.com/design/<file_key>/...?node-id=<id>`)

1. **Parse** `<file_key>` and `<id>` from the URL. The node-id uses `-` (e.g. `456-789`) — use it verbatim as the filename.
2. **Locate** the export folder: `<exportsDir>/<file_key>/`
3. **Read** the design data:
   - `views/<node-id>.json` — the specific screen's tree (layout, spacing, text).
   - `tokens.json` — design tokens (colors, spacing, radius, typography) per mode.
   - `components.json` — component definitions referenced by the view.
   - `styles.json` — color/text/effect styles.
4. **Use the real assets** from `<exportsDir>/<file_key>/assets/` for any node with an `asset` or `assets` field — never invent icons or images.

### When given a design name (no URL — local/draft files)

1. **Scan** `<exportsDir>/` for all `meta.json` files.
2. **Match** the folder whose `meta.json` has a `fileName` closest to what the user described.
3. Proceed with that folder as the root.

### Rebuilding faithfully (applies to both cases)

- Spacing: use `layout.itemSpacing` + `layout.padding` for auto-layout frames; for non-auto-layout, derive gaps from each child's `box` (x/y/w/h).
- Prefer token names (`color.token`, `font.token`) over raw hex so the output matches the project's design system.
- `INSTANCE` nodes reference a component in `components.json` via `componentId`; apply their `props` (variants) and `overrides` (actual text) on top.
- Map to the current project's framework (SwiftUI / React / Flutter / …), reusing existing components and tokens where they already exist.

If the folder or view file is missing, tell the user to run the **"Design Export for AI Agents"** Figma plugin on that file and export again.
