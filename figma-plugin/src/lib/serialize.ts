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

  const views: ViewRecord[] = [];
  const viewIndex: Record<string, string> = {};
  for (let i = 0; i < targets.length; i++) {
    const node = targets[i];
    progress(
      `Exporting "${node.name}" (${i + 1}/${targets.length})…`,
      20 + Math.round((60 * i) / targets.length),
    );
    const tree = await nodeToRecord(node, ctx);
    views.push({ nodeId: node.id, page: pageNameOf(node), tree });
    viewIndex[node.name] = node.id;
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
