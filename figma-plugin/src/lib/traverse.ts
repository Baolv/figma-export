import {
  AssetCollector,
  hasDesignerExportSettings,
  hasImageFill,
  isIconNamed,
  isVectorType,
} from "./assets";
import { ComponentRegistry } from "./components";
import { effectToRecord } from "./styles";
import {
  ColorRef,
  ExportOptions,
  FontInfo,
  LayoutInfo,
  NodeRecord,
} from "./types";
import { colorRefFromSolid, isMixed, paddingOf, toTokenPath } from "./util";

export interface TraverseCtx {
  varNameById: Map<string, string>; // variableId -> token path
  styleNameById: Map<string, string>; // styleId -> token path (local styles cache)
  styleCache: Map<string, string>; // live cache for library style lookups
  registry: ComponentRegistry;
  assets: AssetCollector;
  options: ExportOptions;
}

// Resolve a style id to a token path. Checks the local cache first, then falls
// back to a live Figma API call so library styles (e.g. "12 Red/Red 700",
// "IOS/Caption/Medium" from a shared team library) are also captured.
async function resolveStyleToken(
  styleId: string,
  ctx: TraverseCtx,
): Promise<string | undefined> {
  if (!styleId) return undefined;
  const cached = ctx.styleNameById.get(styleId) ?? ctx.styleCache.get(styleId);
  if (cached) return cached;
  try {
    const style = await figma.getStyleByIdAsync(styleId);
    if (style) {
      const token = toTokenPath(style.name);
      ctx.styleCache.set(styleId, token);
      return token;
    }
  } catch {
    /* style not accessible */
  }
  return undefined;
}

// Resolve a node's SOLID fills to ColorRefs, attaching a token name when the
// fill is bound to a variable or a paint style (including library styles).
async function resolveColorRefs(
  node: SceneNode,
  ctx: TraverseCtx,
): Promise<ColorRef[]> {
  if (!("fills" in node)) return [];
  const fills = (node as GeometryMixin).fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return [];

  const rawStyleId =
    "fillStyleId" in node ? (node as GeometryMixin).fillStyleId : "";
  const styleId = typeof rawStyleId === "string" ? rawStyleId : "";
  const styleToken = await resolveStyleToken(styleId, ctx);

  const bound = (
    node as SceneNode & { boundVariables?: { fills?: VariableAlias[] } }
  ).boundVariables?.fills;

  const out: ColorRef[] = [];
  for (let i = 0; i < fills.length; i++) {
    const p = fills[i];
    if (p.visible === false || p.type !== "SOLID") continue;
    let token = styleToken;
    const alias = bound && bound[i];
    if (alias && ctx.varNameById.get(alias.id)) token = ctx.varNameById.get(alias.id);
    out.push(colorRefFromSolid(p, token));
  }
  return out;
}

async function getFont(t: TextNode, ctx: TraverseCtx): Promise<FontInfo> {
  const font: FontInfo = { family: "", style: "" };
  if (!isMixed(t.fontName)) {
    font.family = (t.fontName as FontName).family;
    font.style = (t.fontName as FontName).style;
  }
  if (!isMixed(t.fontSize)) font.size = t.fontSize as number;
  if (!isMixed(t.fontWeight)) font.weight = t.fontWeight as number;
  if (!isMixed(t.lineHeight)) {
    const lh = t.lineHeight as LineHeight;
    font.lineHeight =
      lh.unit === "AUTO"
        ? "auto"
        : lh.unit === "PERCENT"
          ? (lh.value / 100) * (font.size || 0)
          : lh.value;
  }
  if (!isMixed(t.letterSpacing)) {
    const ls = t.letterSpacing as LetterSpacing;
    font.letterSpacing =
      ls.unit === "PERCENT" ? (ls.value / 100) * (font.size || 0) : ls.value;
  }
  if (!isMixed(t.textCase)) font.textCase = t.textCase as string;
  if (!isMixed(t.textDecoration)) font.textDecoration = t.textDecoration as string;
  font.align = t.textAlignHorizontal;
  // Resolve text style name — works for both local and library styles.
  const sid = t.textStyleId;
  if (typeof sid === "string" && sid) {
    const tok = await resolveStyleToken(sid, ctx);
    if (tok) font.token = tok;
  }
  return font;
}

function getLayout(node: SceneNode): LayoutInfo | undefined {
  const layout: LayoutInfo = { mode: "NONE" };
  if ("layoutMode" in node) {
    const n = node as FrameNode;
    layout.mode = n.layoutMode;
    if (n.layoutMode === "HORIZONTAL" || n.layoutMode === "VERTICAL") {
      layout.itemSpacing = n.itemSpacing;
      layout.padding = paddingOf(n);
      layout.primaryAxisAlign = n.primaryAxisAlignItems;
      layout.counterAxisAlign = n.counterAxisAlignItems;
      if (n.layoutWrap === "WRAP") layout.wrap = true;
    } else if ((n.layoutMode as string) === "GRID") {
      // Grid auto-layout (newer Figma API — guard each property)
      const g = n as unknown as Record<string, unknown>;
      if (typeof g.gridRowCount === "number") layout.gridRowCount = g.gridRowCount;
      if (typeof g.gridColumnCount === "number") layout.gridColumnCount = g.gridColumnCount;
      if (typeof g.gridRowGap === "number") layout.gridRowGap = g.gridRowGap;
      if (typeof g.gridColumnGap === "number") layout.gridColumnGap = g.gridColumnGap;
      layout.padding = paddingOf(n);
    }
  }
  // sizing of this node within its parent's auto-layout
  try {
    if ("layoutSizingHorizontal" in node) {
      const n = node as FrameNode;
      layout.sizingH = n.layoutSizingHorizontal;
      layout.sizingV = n.layoutSizingVertical;
    }
  } catch {
    /* sizing not available for this node */
  }
  if (layout.mode === "NONE" && !layout.sizingH) return undefined;
  return layout;
}

function componentPropsOf(inst: InstanceNode): Record<string, string> {
  const props: Record<string, string> = {};
  try {
    const cp = inst.componentProperties;
    for (const key of Object.keys(cp)) {
      const name = key.split("#")[0];
      props[name] = String(cp[key].value);
    }
  } catch {
    /* component set has errors — skip properties */
  }
  return props;
}

// Actual text content shown by an instance (labels like "Sign in"), so Claude
// uses the real copy rather than the component's default.
function textOverridesOf(inst: InstanceNode): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const texts = inst.findAllWithCriteria({ types: ["TEXT"] }) as TextNode[];
    for (const t of texts) {
      if (typeof t.characters === "string" && t.characters) out[t.name] = t.characters;
    }
  } catch {
    /* instance not readable */
  }
  return out;
}

async function applyVisualProps(rec: NodeRecord, node: SceneNode, ctx: TraverseCtx) {
  const fills = await resolveColorRefs(node, ctx);
  if (fills.length) rec.fills = fills;

  if ("strokes" in node) {
    const strokes = (node as GeometryMixin).strokes;
    if (Array.isArray(strokes) && strokes.length) {
      const refs = strokes
        .filter((s) => s.visible !== false && s.type === "SOLID")
        .map((s) => colorRefFromSolid(s as SolidPaint));
      if (refs.length) rec.strokes = refs;
      const sw = (node as GeometryMixin).strokeWeight;
      if (!isMixed(sw)) rec.strokeWeight = sw as number;
    }
  }

  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (!isMixed(cr) && typeof cr === "number" && cr > 0) {
      rec.cornerRadius = cr;
    } else if (isMixed(cr) && "topLeftRadius" in node) {
      const n = node as RectangleNode;
      rec.cornerRadius = {
        t: n.topLeftRadius,
        r: n.topRightRadius,
        b: n.bottomRightRadius,
        l: n.bottomLeftRadius,
      };
    }
  }

  if ("effects" in node) {
    const effects = (node as BlendMixin).effects;
    if (effects.length) {
      rec.effects = effects
        .filter((e) => e.visible !== false)
        .map((e) => effectToRecord(e));
    }
  }
}

// Decides how to export a node as an asset and writes paths onto rec.
// Returns true if the node is a leaf (children should not be walked).
async function exportAsset(
  node: SceneNode,
  rec: NodeRecord,
  ctx: TraverseCtx,
): Promise<boolean> {
  const isFrame =
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "COMPONENT_SET";

  // ── Mode: settings-only ───────────────────────────────────────────────────
  // Export ONLY nodes the designer explicitly marked in Figma's Export panel.
  // Format and scale come from Figma — no plugin config needed.
  if (ctx.options.assetMode === "settings-only") {
    if (hasDesignerExportSettings(node)) {
      const { primaryPath, assets } = await ctx.assets.exportFromSettings(node);
      if (primaryPath) {
        rec.asset = primaryPath;
        if (assets) rec.assets = assets;
        // Frames still walk children even when exported — non-frames are leaves.
        if (!isFrame) return true;
      }
    }
    return false; // walk children
  }

  // ── Mode: auto ────────────────────────────────────────────────────────────
  // Priority 1 — designer export settings (any node type, including frames).
  // Always treated as a leaf for non-frames — never fall through to auto-detection
  // even if the export fails, so the designer's explicit format choice is respected.
  if (hasDesignerExportSettings(node)) {
    const { primaryPath, assets } = await ctx.assets.exportFromSettings(node);
    if (primaryPath) {
      rec.asset = primaryPath;
      if (assets) rec.assets = assets;
    }
    if (!isFrame) return true;
  }

  // Priority 2 — raster image fill. Not a leaf — can have children (e.g. text
  // overlaid on a photo), so we export the fill but keep walking.
  if (hasImageFill(node)) {
    const o = ctx.options;
    const { primaryPath, assets } = await ctx.assets.exportAll(
      node, o.imageFormats, o.imagePngScales, o.imageJpegScales,
    );
    if (primaryPath) rec.asset = primaryPath;
    if (assets) rec.assets = assets;
    return false;
  }

  // Priority 3 — primitive vector type. Always a leaf.
  if (isVectorType(node)) {
    const o = ctx.options;
    const { primaryPath, assets } = await ctx.assets.exportAll(
      node, o.iconFormats, o.iconPngScales, o.iconJpegScales,
    );
    if (primaryPath) {
      rec.asset = primaryPath;
      if (assets) rec.assets = assets;
      return true;
    }
  }

  // Priority 4 — icon-named INSTANCE or GROUP (name heuristic, last resort).
  if (isIconNamed(node)) {
    const o = ctx.options;
    const { primaryPath, assets } = await ctx.assets.exportAll(
      node, o.iconFormats, o.iconPngScales, o.iconJpegScales,
    );
    if (primaryPath) {
      rec.asset = primaryPath;
      if (assets) rec.assets = assets;
      return true;
    }
  }

  return false;
}

export async function nodeToRecord(
  node: SceneNode,
  ctx: TraverseCtx,
): Promise<NodeRecord> {
  const rec: NodeRecord = { id: node.id, name: node.name, type: node.type };
  if (node.visible === false) rec.visible = false;

  if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
    const b = node.absoluteBoundingBox;
    rec.box = { x: b.x, y: b.y, w: b.width, h: b.height };
  }
  if ("opacity" in node && (node as SceneNodeMixin & MinimalBlendMixin).opacity !== 1) {
    rec.opacity = (node as MinimalBlendMixin).opacity;
  }

  // INSTANCE -> reference the component; do not inline its internals.
  if (node.type === "INSTANCE") {
    const inst = node as InstanceNode;
    const main = await inst.getMainComponentAsync();
    if (main) {
      rec.componentId = await ctx.registry.ensure(main, (n) => nodeToRecord(n, ctx));
      rec.component =
        main.parent && main.parent.type === "COMPONENT_SET"
          ? main.parent.name
          : main.name;
    }
    const props = componentPropsOf(inst);
    if (Object.keys(props).length) rec.props = props;
    const overrides = textOverridesOf(inst);
    if (Object.keys(overrides).length) rec.overrides = overrides;
    rec.layout = getLayout(node);
    await exportAsset(node, rec, ctx); // attaches asset paths if applicable
    return rec;
  }

  // TEXT
  if (node.type === "TEXT") {
    const t = node as TextNode;
    if (t.characters) rec.text = t.characters;
    rec.font = await getFont(t, ctx);
    const colors = await resolveColorRefs(t, ctx);
    if (colors.length) rec.color = colors[0];
    return rec;
  }

  // ── Asset export — FRAMES always walk children, never become asset leaves ──
  const isLeaf = await exportAsset(node, rec, ctx);
  if (isLeaf) return rec;

  await applyVisualProps(rec, node, ctx);
  rec.layout = getLayout(node);

  if ("children" in node) {
    const kids: NodeRecord[] = [];
    for (const child of (node as ChildrenMixin).children as SceneNode[]) {
      kids.push(await nodeToRecord(child, ctx));
    }
    if (kids.length) rec.children = kids;
  }

  return rec;
}
