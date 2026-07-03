// Neutral, framework-agnostic data model produced by the plugin.
// Claude maps these structures onto whatever UI framework a project uses.

export type ExportScope = "selection" | "page" | "top-frames" | "file";
export type AssetFormat = "SVG" | "PNG" | "JPEG" | "PDF";

// "settings-only" — export ONLY nodes the designer explicitly marked in
//   Figma's Export panel. Format and scale come from Figma, no extra config.
// "auto" — export settings first, then fall back to image-fill detection,
//   vector type detection, and name heuristics. Uses the format/scale options.
export type AssetMode = "settings-only" | "auto";

export interface ExportOptions {
  scope: ExportScope;
  assetMode: AssetMode;
  // Used only when assetMode === "auto"
  iconFormats: AssetFormat[];
  iconPngScales: number[];
  iconJpegScales: number[];
  imageFormats: AssetFormat[];
  imagePngScales: number[];
  imageJpegScales: number[];
  jpegQuality: number;
  modes: string[] | null;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Padding {
  t: number;
  r: number;
  b: number;
  l: number;
}

// A resolved color: keeps the semantic token name when the fill is bound to a
// variable/style, so Claude writes `color.primary` rather than a raw hex.
export interface ColorRef {
  token?: string; // e.g. "color.primary"
  hex: string; // resolved fallback, always present, e.g. "#FF6B35"
  opacity?: number;
}

export interface FontInfo {
  token?: string; // text style token, e.g. "text.heading-1", when bound
  family: string;
  style: string; // e.g. "Semi Bold"
  weight?: number;
  size?: number;
  lineHeight?: number | "auto";
  letterSpacing?: number;
  textCase?: string;
  textDecoration?: string;
  align?: string;
}

export interface EffectInfo {
  type: string; // DROP_SHADOW, INNER_SHADOW, ...
  color?: ColorRef;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface LayoutInfo {
  mode: string; // NONE | HORIZONTAL | VERTICAL | GRID
  itemSpacing?: number;
  padding?: Padding;
  primaryAxisAlign?: string;
  counterAxisAlign?: string;
  wrap?: boolean;
  // sizing of THIS node within its parent's auto-layout
  sizingH?: string; // FIXED | HUG | FILL
  sizingV?: string;
}

// One node in a view tree.
export interface NodeRecord {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  // geometry — always present so non-auto-layout gaps are computable
  box?: { x: number; y: number; w: number; h: number };
  layout?: LayoutInfo;
  fills?: ColorRef[];
  strokes?: ColorRef[];
  strokeWeight?: number;
  cornerRadius?: number | Padding; // uniform, or per-corner {t=l tl, r=tr, b=br, l=bl}
  opacity?: number;
  effects?: EffectInfo[];
  // text
  text?: string;
  font?: FontInfo;
  color?: ColorRef;
  // instance -> component reference (defined once in components.json)
  component?: string; // component key/name
  componentId?: string;
  props?: Record<string, string>; // variant / component properties
  overrides?: Record<string, unknown>;
  // exported asset (icon/image)
  asset?: string; // e.g. "assets/icon-google.svg"
  assets?: Record<string, string>; // scale -> path for multi-scale PNG
  children?: NodeRecord[];
}

export interface ViewRecord {
  nodeId: string;
  page: string;
  tree: NodeRecord;
}

export interface AssetRecord {
  path: string; // relative, e.g. "assets/icon-google.svg"
  format: AssetFormat;
  base64: string;
}

export interface TokenBundle {
  colors: Record<string, Record<string, string>>; // name -> mode -> hex
  numbers: Record<string, Record<string, number>>; // spacing/radius/etc -> mode -> value
  strings: Record<string, Record<string, string>>;
  booleans: Record<string, Record<string, boolean>>;
  modes: string[];
}

export interface StyleBundle {
  colors: Record<string, ColorRef[]>;
  text: Record<string, FontInfo>;
  effects: Record<string, EffectInfo[]>;
}

export interface ComponentRecord {
  id: string;
  key: string;
  name: string;
  description?: string;
  variantProps?: Record<string, string[]>; // prop -> possible values
  tree: NodeRecord; // the component's own anatomy
}

export interface ExportBundle {
  meta: {
    fileKey: string;
    fileName: string;
    exportedFrom: string; // page name or "file"
    scope: ExportScope;
    pages: string[];
    viewIndex: Record<string, string>; // view name -> nodeId
  };
  tokens: TokenBundle;
  styles: StyleBundle;
  components: Record<string, ComponentRecord>; // keyed by component id
  views: ViewRecord[];
  assets: AssetRecord[];
}
