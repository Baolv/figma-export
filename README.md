# Design Export for AI Agents

A Figma plugin that exports full design data — tokens, spacing, typography, components, icons, and images — as a ZIP file, so any AI agent (Claude, Cursor, Copilot, etc.) can implement UI screens pixel-perfect from just a Figma URL.

> Community plugin — not affiliated with Figma Inc.

---

## Why this exists

When you ask an AI to implement a UI from Figma, it usually guesses at colors, invents placeholder icons, and gets spacing wrong. This plugin fixes that by giving the AI **everything it needs** — not a screenshot, but the actual structured design data plus the real exported assets.

| Approach | Rate limits | Design tokens | Asset export | Plan required |
|---|---|---|---|---|
| Figma REST API | Yes | Enterprise only | Limited | Enterprise |
| Dev Mode | None | Yes | Yes | Paid |
| **This plugin** | **None** | **Yes** | **Yes** | **Free** |

The Figma **Plugin API** runs inside Figma with full access to variables, styles, and assets — no rate limits, no plan restrictions.

---

## How it works

```
Figma Plugin
  → reads design data (tokens, layout, components, assets)
  → builds ZIP in-browser
  → downloads to your machine

You
  → extract ZIP → move folder to your exports directory

AI Agent
  → reads the JSON + assets → implements UI 1:1
```

No server. No terminal. No build step. The plugin is pre-built — just import and use.

---

## Setup — 3 steps

### Step 1 — Import the plugin into Figma desktop

> You need the **Figma desktop app**. The browser version doesn't support local plugins.
> Download free at figma.com/downloads.

1. Open the Figma desktop app
2. Open any design file (plugins only work inside files, not the home screen)
3. Press `⌘ /` → type **"Import plugin from manifest"** → press Enter
4. Select: `figma-plugin/manifest.json` from this repo
5. Done — the plugin is now available in all your Figma files

### Step 2 — Create your exports folder

```bash
mkdir -p ~/figma-exports
```

This is where you'll move extracted exports. If you prefer a different location (e.g. a shared Dropbox folder), create it and set a config file:

```bash
# Create your preferred folder
mkdir -p ~/Dropbox/figma-exports

# Tell your AI agent to look there
echo '{"exportsDir":"~/Dropbox/figma-exports"}' > ~/.figma-export.json
```

`~/.figma-export.json` lives in your home directory — it's never committed to git. AI agents read it automatically. Skip this if `~/figma-exports` works for you.

### Step 3 — Add the AI agent rule

Add the contents of `CLAUDE.md-snippet.md` to your AI agent's config:

**Claude Code** — append to `~/.claude/CLAUDE.md`:
```bash
cat CLAUDE.md-snippet.md >> ~/.claude/CLAUDE.md
```

**Cursor** — paste into `.cursorrules` in your project root.

**Other agents** — paste into the system prompt or equivalent config.

---

## Using the plugin

### Every time you want to export a design:

**1. Open your design file in Figma desktop**

Navigate to the page with the screens you want.

**2. Launch the plugin**

Press `⌘ /` → type **"Design Export for AI Agents"** → Enter.

Or: right-click canvas → **Plugins → Development → Design Export for AI Agents**.

**3. Choose your options**

| Option | What it does |
|---|---|
| **Scope** | Which frames to export — pick "All top-level frames" to export the whole page |
| **Assets** | "Export settings only" (recommended) respects what designers marked in Figma's Export panel. "Auto detect" also picks up vectors, image fills, and icon-named layers |
| **Token modes** | Which variable modes to include (e.g. light / dark) |

**4. Click "Export & Download"**

The plugin scans the design, builds a ZIP, and downloads it. You'll see a progress bar and a success message with file counts.

**5. Extract and move the folder**

Double-click the downloaded `.zip`. You'll get a folder named after your file key (e.g. `ABC123/`). Drag it into `~/figma-exports/`.

> **Re-exporting the same file?** Extract the new ZIP and drag to `~/figma-exports/` — macOS will ask "Replace?" → click Replace.
>
> **Multiple files?** Each file gets a different folder name — they coexist without conflict.

---

## Using with your AI agent

Once the export folder is in place, paste the frame's Figma URL to your AI agent:

```
Implement this screen as a SwiftUI view:
https://www.figma.com/design/ABC123/MyApp?node-id=456-789
```

The agent will:
1. Parse `ABC123` (file key) and `456-789` (node id) from the URL
2. Read `~/figma-exports/ABC123/views/456-789.json` for the screen layout
3. Read `tokens.json` for colors, spacing, and typography
4. Look up components in `components.json`
5. Use real icons from `assets/*.svg` and images from `assets/*.png`
6. Implement in your project's framework, reusing existing components where they exist

**To get a frame's URL in Figma:**
Click the frame → right-click → **Copy link to selection** → paste to your AI agent.

---

## Output structure

```
~/figma-exports/
  ABC123/                    ← one folder per Figma file
    meta.json                ← file name, pages, view index (name → node-id)
    tokens.json              ← design tokens per mode (colors, spacing, radius, type)
    styles.json              ← color / text / effect styles
    components.json          ← every component defined once (referenced by views)
    views/
      456-789.json           ← one screen — layout tree with exact spacing & tokens
      456-812.json
    assets/
      icon-google.svg        ← real SVG icons
      hero-bg@2x.png         ← real images at configured scales
      hero-bg@3x.png
```

---

## Plugin options reference

### Scope

| Option | Exports | Use when |
|---|---|---|
| All top-level frames | Every frame on the current page | Working on one page — run once, all screens available |
| Current selection | Only the frame(s) you have selected | Refreshing a single updated screen |
| Everything on this page | Frames + loose groups and annotations | Page has flow diagrams outside frames |
| All frames in the file | Every frame across all pages | Full app handoff — run once at sprint start |

### Assets — export settings only vs auto detect

**Export settings only** (default, recommended): exports only layers you explicitly marked in Figma's Export panel (right panel → Export → `+`). Format and scale come from Figma — no guessing.

**Auto detect**: also exports by image fill, vector node type, and layer name pattern (`icon`, `logo`, `glyph`). Useful when the file has no export settings configured.

### Token modes

If your Figma file has variable collections with multiple modes (e.g. light / dark), the plugin lists them as checkboxes. Uncheck any you don't need. "Mode 1" is Figma's default name when modes haven't been renamed — it just means a single set of values.

---

## Customising the export path

By default the AI agent looks for exports in `~/figma-exports`. To use a different folder, create `~/.figma-export.json`:

```bash
echo '{"exportsDir":"/your/preferred/path"}' > ~/.figma-export.json
```

This file:
- Lives in your home directory — never committed to git
- Is read automatically by the AI agent rule
- Defaults to `~/figma-exports` if the file doesn't exist

---

## Troubleshooting

**"The export folder is missing"**
You haven't moved the extracted ZIP folder to `~/figma-exports/` yet. Extract the downloaded ZIP and drag the inner folder there.

**The folder name is always the same (e.g. `zalora-app/`)**
Your Figma file is an unsaved local draft — it has no real file key. Save the file to Figma cloud to get a unique key. Local drafts use a slug of the file name.

**"Component set has existing errors"**
A component in your file has broken variants. The plugin skips its properties and continues — the export still works, just without variant props for that component. Fix the broken component in Figma to resolve it.

**Claude can't find the right folder after using a custom path**
Check that `~/.figma-export.json` has the correct path and that you actually moved the export folder there. Run `cat ~/.figma-export.json` to verify.

---

## For developers

The plugin is pre-built — normal users don't need this section.

If you modify the TypeScript source under `figma-plugin/src/`, recompile before testing:

```bash
cd figma-plugin
npm install
npm run build    # compiles src/code.ts → code.js
```

Figma picks up the updated `code.js` automatically on the next plugin run.
