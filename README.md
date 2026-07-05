# Design Export for AI Agents

A Figma plugin that exports full design data — tokens, spacing, typography, components, icons, images, and screen screenshots — as a ZIP file, so any AI agent (Claude, Cursor, Copilot, etc.) can implement UI screens pixel-perfect from just a Figma URL.

> Community plugin — not affiliated with Figma Inc.

---

## Why this exists

When you ask an AI to implement a UI from Figma, it usually guesses at colors, invents placeholder icons, and gets spacing wrong. This plugin fixes that by giving the AI **everything it needs** — not just a screenshot, but structured design data plus real exported assets plus visual previews.

### vs the official Figma MCP

The official Figma MCP fetches design data live from Figma's API on every request; this plugin pre-exports everything to local files once.

| | Official Figma MCP | This plugin |
|---|---|---|
| **Design data** | Raw Figma API JSON — verbose, every node property | Pre-filtered, implementation-ready JSON |
| **Access** | Live API round-trips per request | Local file reads, works offline |
| **Component screenshots** | No | Yes — full-res PNG per component |
| **Staleness detection** | No | Yes — warns if export > 14 days old |
| **Code-map learning** | No — starts from scratch each session | Yes — grows across implementations, survives re-exports |
| **Always fresh** | Yes | Requires re-export on design change |

> Token usage and implementation speed haven't been benchmarked against the official MCP on real projects yet — the filtered local format should be meaningfully smaller and faster, but treat that as expectation, not measurement.

The code map compounds across screens — once a Figma component is mapped to a project file, every future screen reuses that mapping instantly.

### vs Figma REST API / Dev Mode

| Approach | Rate limits | Design tokens | Asset export | Plan required |
|---|---|---|---|---|
| Figma REST API | Yes | Enterprise only | Limited | Enterprise |
| Dev Mode | None | Yes | Yes | Paid |
| **This plugin** | **None** | **Yes** | **Yes** | **Free** |

---

## How it works

```
Figma Plugin
  → reads design data (tokens, layout, components, assets)
  → renders PNG screenshots of every view + component
  → builds ZIP in-browser
  → downloads to your machine

You
  → extract ZIP → move folder to your exports directory

AI Agent (via the figma-lookup skill)
  → reads JSON + PNGs + assets → implements UI 1:1
```

No server. No terminal. No build step. The plugin is pre-built — just import and use.

---

## Setup — 3 steps

### Step 1 — Import the plugin into Figma desktop

> You need the **Figma desktop app**. The browser version doesn't support local plugins.
> Download free at figma.com/downloads.

1. Open the Figma desktop app
2. Open any design file
3. Press `⌘ /` → type **"Import plugin from manifest"** → press Enter
4. Select: `figma-plugin/manifest.json` from this repo

### Step 2 — Create your exports folder

```bash
mkdir -p ~/figma-exports
```

If you prefer a different location:

```bash
mkdir -p ~/Dropbox/figma-exports
echo '{"exportsDir":"~/Dropbox/figma-exports"}' > ~/.figma-export.json
```

`~/.figma-export.json` is per-user and never committed to git.

### Step 3 — Install the skill

```bash
mkdir -p .claude/skills
cp -r skills/figma-lookup .claude/skills/
```

Then use `/figma-lookup <figma-url>` or `/figma-lookup <figma-url> implement`. The skill handles URL parsing, node lookup, staleness check, device-chrome detection, and smart asset matching.

The SKILL.md format is supported by all major coding agents. To install globally instead of per-project, copy to `~/.claude/skills/`. If your agent doesn't support skills, paste the contents of `skills/figma-lookup/SKILL.md` into its rules file (e.g. `.cursorrules`).

---

## Using the plugin

**1. Open your design file in Figma desktop**

**2. Launch the plugin** — `⌘ /` → "Design Export for AI Agents"

**3. Choose scope and assets** — see reference below

**4. Click "Export & Download"** — the plugin renders screenshots, bundles everything, and downloads a ZIP

**5. Extract and move** — double-click the ZIP, drag the inner folder to `~/figma-exports/`

---

## Using with your AI agent

Paste any Figma URL — including links to nested components inside frames:

```
Implement this screen as SwiftUI:
https://www.figma.com/design/ABC123/MyApp?node-id=456-789
```

The agent will:
1. Parse the file key, file name, and node id from the URL, then resolve the export folder — by key if present, otherwise by matching the file name (Figma only exposes the real file key to private plugins, so export folders are usually named after the file, e.g. `nc-journey/`)
2. Use `node-index.json` to resolve any nested node — not just top-level frames
3. Read the view JSON for exact layout, spacing, tokens
4. Read the view PNG for visual context (sizes always come from JSON, not the image)
5. Read component PNGs for small components (icons, buttons) that need full-res legibility
6. Check `exportedAt` — warns if the export is stale (> 14 days old)
7. Skip device chrome (status bar, home indicator) — handled via platform APIs instead
8. Match assets to existing project files via dimensions + visual comparison
9. Grow the code map (`code-maps/<file_key>.json`) with every confirmed Figma component → project file match

**To copy a Figma URL:** right-click any frame, group, or component → **Copy link to selection**.

---

## Output structure

```
~/figma-exports/
  code-maps/
    ABC123.json         ← (created by skill) Figma component → project file map
  ABC123/               ← replaced wholesale on re-export
    meta.json           ← file name, pages, exportedAt timestamp, view index
    tokens.json         ← design tokens per mode (colors, spacing, radius, type)
    styles.json         ← color / text / effect styles
    components.json     ← every component defined once (referenced by views)
    node-index.json     ← flat map: any node-id → which view file contains it
    views/
      456-789.json      ← layout tree with exact spacing & tokens
      456-789.png       ← PNG screenshot (capped at 800px wide)
      456-812.json
      456-812.png
    components/
      16102-7164.png    ← full-res PNG per component (icons, buttons at natural size)
    assets/
      icon-google.svg
      hero-bg@2x.png
```

**`node-index.json`** — resolves any Figma URL, even deeply nested nodes, without re-exporting.

**`views/<id>.png`** — visual reference. Sizes always come from the JSON; the PNG gives visual context. Capped at 800px wide for ZIP size.

**`components/<id>.png`** — full-resolution per-component screenshots. View PNGs can downscale 24px icons to illegibility; these are always crisp.

**`code-maps/<file_key>.json`** — owned by the skill, not the plugin. It lives *next to* the export folder (not inside it) so replacing the folder on re-export never deletes it. Entries are keyed by Figma's stable component key, so renaming a component in Figma doesn't break its mapping.

---

## Plugin options reference

### Scope

| Option | Exports | Use when |
|---|---|---|
| **Everything on this page** *(default)* | All frames + full node index | Most common — works for any Figma URL |
| Current selection | Only selected frame(s) | Refreshing a single updated screen |
| Everything in this file | All frames across all pages | Full app handoff at sprint start |

### Assets

**Export settings only** (recommended) — exports only layers marked in Figma's Export panel. Applies to all node types including FRAME nodes — if a frame has export settings it exports AND walks children.

**Auto detect** — also exports by image fill, vector type, and name heuristics (`icon`, `logo`, `glyph`). Useful when the file has no export settings.

---

## Troubleshooting

**Node not found from a Figma URL**
Re-export with "Everything on this page" — this builds `node-index.json` which resolves any nested node.

**Icons exporting as SVG instead of PDF**
Use "Export settings only". FRAME nodes with PDF export settings now export correctly (fixed in v1.1.0).

**"The export folder is missing"**
Move the extracted ZIP folder to `~/figma-exports/`. The folder is usually named after the Figma file name (e.g. `nc-journey/`), not the key in the URL — Figma only exposes the real file key to private plugins. The skill resolves this automatically by matching the file name from the URL against each folder's `meta.json`.

**Two Figma files with the same name**
Since folders are named by file name, two files both called "App Design" would collide. Rename one of the files in Figma before exporting.

**"Component set has existing errors"**
A component has broken variants — the plugin skips its properties and continues. Fix in Figma to resolve.

---

## Known limits

- **Large exports.** Screenshots and full-screen assets dominate ZIP size — a 60-screen page exports at roughly 35MB (verified working). If designers marked every screen frame for export, those full-screen renders account for most of it; unmark screens you don't need as image deliverables.
- **Single-shot transfer.** The export is handed to the download step in one message. Verified fine up to ~36MB; extremely large files (hundreds of screens in one run) may need to be exported page by page.

---

## Changelog

### v1.2.0
- **Per-screen view files** — when a page uses SECTION boards containing many device-sized screen frames, each screen is now emitted as its own `views/<id>.json` + PNG. Previously an agent resolving a nested node had to load the entire multi-screen board (e.g. a 1.1MB, 1,378-node section) and walk it; now it loads just the ~45KB screen. `node-index.json` points nested nodes at their specific screen, while nodes outside any screen (flow arrows, notes) still resolve to the board. Big reduction in tokens per implementation.

### v1.1.1
- **Color fix** — `hex` in node fills, strokes, and effect colors was emitting 8-digit `#RRGGBBAA` (e.g. `#ffffff03`) that SwiftUI/CSS can't parse, while also duplicating the alpha in the `opacity` field. `hex` is now always 6-digit `#RRGGBB`; use the `opacity` field for alpha. (Token colors keep 8-digit hex since they have no separate opacity field.)

### v1.1.0
- **View screenshots** — every exported view includes a `views/<id>.png` PNG (capped 800px wide)
- **Component screenshots** — every component has a `components/<id>.png` at full resolution
- **Staleness detection** — `meta.json` now includes `exportedAt`; the skill warns when exports are > 14 days old
- **PDF asset fix** — FRAME nodes with designer export settings (e.g. PDF icons) were silently skipped; now they export and walk children
- **Device chrome detection** — the `figma-lookup` skill skips status bars, home indicators, and system nav bars, replacing them with platform API comments
- **Smart asset matching** — dimensions + visual comparison instead of fragile name/hash matching; works for iOS imagesets, Android drawables, Web SVG/PNG, Flutter
- **Default scope** — "Everything on this page" is now default (removed "All top-level frames")
- **GRID layout support** — grid auto-layout frames now export `gridRowCount`, `gridColumnCount`, `gridRowGap`, `gridColumnGap`
- **Code map moved** — now at `<exportsDir>/code-maps/<file_key>.json` (outside the per-file folder, so re-exports can't delete it) and keyed by stable component key (rename-proof)
- **Removed `CLAUDE.md-snippet.md`** — the skill is the single integration path; paste SKILL.md into your agent's rules file if it doesn't support skills

### v0.2.0 (tag only, no GitHub release)
- `node-index.json` — resolves any nested Figma URL without re-exporting
- `figma-lookup` Claude Code skill

### v1.0.0
- Initial release: tokens, layout trees, components, assets, ZIP export
