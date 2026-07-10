import { AssetCollector } from "./assets";
import { ComponentRegistry } from "./components";
import { resolveStyles } from "./styles";
import { resolveTokens } from "./tokens";
import { nodeToRecord, TraverseCtx } from "./traverse";
import { ExportBundle, ExportOptions, NodeRecord, ViewRecord } from "./types";

type Progress = (message: string, pct?: number) => void;

const CONTAINER_TYPES = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "GROUP",
  "SECTION",
]);

// A FRAME that looks like a device artboard (a "screen"). Designers group many
// of these inside a SECTION board; we promote each to its own view file so an
// agent resolving a nested node loads just that screen, not the whole board.
function isScreenFrame(node: SceneNode): boolean {
  if (node.type !== "FRAME") return false;
  const f = node as FrameNode;
  if (f.children.length === 0) return false;
  const w = f.width;
  const h = f.height;
  return w >= 200 && w <= 1440 && h >= 320 && h <= 3000;
}

// Collect screen frames nested inside a SECTION. Screens are the leaves of the
// search — we don't look inside a screen for more screens, only into sub-sections.
function collectScreenFrames(section: SectionNode, acc: SceneNode[]): void {
  for (const child of section.children) {
    if (isScreenFrame(child)) acc.push(child);
    else if (child.type === "SECTION") collectScreenFrames(child, acc);
  }
}

// Pick the nodes that become top-level "views" for the chosen scope.
function targetsForScope(scope: ExportOptions["scope"]): SceneNode[] {
  switch (scope) {
    case "selection":
      return [...figma.currentPage.selection];
    case "page":
      return figma.currentPage.children.filter((n) =>
        CONTAINER_TYPES.has(n.type),
      ) as SceneNode[];
    case "top-frames":
      return figma.currentPage.children.filter(
        (n) => n.type === "FRAME",
      ) as SceneNode[];
    case "file": {
      const out: SceneNode[] = [];
      for (const page of figma.root.children) {
        for (const n of page.children) {
          if (n.type === "FRAME") out.push(n as SceneNode);
        }
      }
      return out;
    }
  }
}

function buildNodeIndex(views: ViewRecord[]): Record<string, string> {
  const index: Record<string, string> = {};
  function walk(node: NodeRecord, viewId: string) {
    index[node.id.replace(/:/g, "-")] = viewId;
    for (const child of node.children || []) walk(child, viewId);
  }
  for (const view of views) {
    const viewId = String(view.nodeId).replace(/:/g, "-");
    walk(view.tree, viewId);
  }
  return index;
}

function pageNameOf(node: BaseNode): string {
  let p: BaseNode | null = node;
  while (p && p.type !== "PAGE") p = p.parent;
  return p ? p.name : "";
}

export async function buildBundle(
  options: ExportOptions,
  progress: Progress,
): Promise<ExportBundle> {
  // dynamic-page access requires pages be loaded before cross-page traversal.
  await figma.loadAllPagesAsync();

  progress("Resolving design tokens…", 5);
  const tokens = await resolveTokens(options.modes);

  progress("Resolving styles…", 15);
  const styles = await resolveStyles();

  const registry = new ComponentRegistry();
  const assets = new AssetCollector(options);
  const ctx: TraverseCtx = {
    varNameById: tokens.nameById,
    styleNameById: styles.nameById,
    styleCache: new Map(), // live cache for library style lookups
    registry,
    assets,
    options,
  };

  const targets = targetsForScope(options.scope);
  if (targets.length === 0) {
    throw new Error(
      options.scope === "selection"
        ? "Nothing selected. Select a frame, or choose a different scope."
        : "No frames found for the chosen scope.",
    );
  }

  // Promote screen frames nested inside SECTION boards to their own views.
  // Order matters: boards first, screens last — buildNodeIndex is last-writer-
  // wins, so a nested node ends up pointing at its specific screen, not the board.
  const seen = new Set(targets.map((t) => t.id));
  const screens: SceneNode[] = [];
  for (const t of targets) {
    if (t.type === "SECTION") collectScreenFrames(t as SectionNode, screens);
  }
  const allTargets = [...targets, ...screens.filter((s) => !seen.has(s.id))];

  const views: ViewRecord[] = [];
  const viewIndex: Record<string, string> = {};
  for (let i = 0; i < allTargets.length; i++) {
    const node = allTargets[i];
    progress(
      `Exporting "${node.name}" (${i + 1}/${allTargets.length})…`,
      20 + Math.round((60 * i) / allTargets.length),
    );
    const tree = await nodeToRecord(node, ctx);
    // Preview render so consumers get visual context alongside the data.
    // Skip SECTION boards — an 800px thumbnail of a huge multi-screen canvas is
    // unreadable; the promoted per-screen previews are the useful ones.
    let preview: string | undefined;
    if (node.type !== "SECTION") {
      try {
        const wide = "width" in node && (node as LayoutMixin).width > 800;
        const bytes = await (node as ExportMixin).exportAsync(
          wide
            ? { format: "PNG", constraint: { type: "WIDTH", value: 800 } }
            : { format: "PNG" },
        );
        preview = figma.base64Encode(bytes);
      } catch {
        /* preview is optional — ui reports the count of missing previews */
      }
    }
    views.push({ nodeId: node.id, page: pageNameOf(node), tree, preview });
    // dash form to match filenames and node-index (Figma URLs use "-" too)
    viewIndex[node.name] = node.id.replace(/:/g, "-");
  }

  progress("Packaging bundle…", 90);
  const bundle: ExportBundle = {
    meta: {
      fileKey: figma.fileKey || figma.root.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "local",
      fileName: figma.root.name,
      exportedAt: new Date().toISOString(),
      exportedFrom:
        options.scope === "file" ? "file" : figma.currentPage.name,
      scope: options.scope,
      pages: figma.root.children.map((p) => p.name),
      viewIndex,
    },
    tokens: tokens.bundle,
    styles: styles.bundle,
    components: registry.all(),
    views,
    assets: assets.list(),
    nodeIndex: buildNodeIndex(views),
  };
  return bundle;
}
