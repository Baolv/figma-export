import { AssetFormat, AssetRecord, ExportOptions } from "./types";

// Collects exported assets, de-duplicating identical bytes so a shared icon
// used in many views is stored once.
export class AssetCollector {
  private assets: AssetRecord[] = [];
  private byHash = new Map<string, string>(); // contentHash -> path
  private usedNames = new Set<string>();

  constructor(private options: ExportOptions) {}

  list(): AssetRecord[] {
    return this.assets;
  }

  private safeName(node: BaseNode): string {
    const base =
      node.name
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 40) || "node";
    let name = base;
    let i = 1;
    while (this.usedNames.has(name)) name = `${base}-${i++}`;
    this.usedNames.add(name);
    return name;
  }

  // FNV-1a — cheap content hash for de-duplication.
  private hash(bytes: Uint8Array): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  private push(bytes: Uint8Array, path: string, format: AssetFormat): string {
    const key = `${format}:${this.hash(bytes)}:${bytes.length}`;
    const existing = this.byHash.get(key);
    if (existing) return existing;
    this.assets.push({ path, format, base64: figma.base64Encode(bytes) });
    this.byHash.set(key, path);
    return path;
  }

  // --- per-format exporters ---

  async exportSvg(node: SceneNode): Promise<string | undefined> {
    try {
      const bytes = await (node as ExportMixin).exportAsync({ format: "SVG" });
      return this.push(bytes, `assets/${this.safeName(node)}.svg`, "SVG");
    } catch {
      return undefined;
    }
  }

  async exportPng(node: SceneNode, scales: number[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const name = this.safeName(node);
    for (const scale of scales) {
      try {
        const bytes = await (node as ExportMixin).exportAsync({
          format: "PNG",
          constraint: { type: "SCALE", value: scale },
        });
        const suffix = scale === 1 ? "" : `@${scale}x`;
        out[`${scale}x`] = this.push(bytes, `assets/${name}${suffix}.png`, "PNG");
      } catch { /* skip */ }
    }
    return out;
  }

  async exportJpeg(node: SceneNode, scales: number[], quality: number): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const name = this.safeName(node);
    for (const scale of scales) {
      try {
        const bytes = await (node as ExportMixin).exportAsync({
          format: "JPG",
          constraint: { type: "SCALE", value: scale },
        });
        const suffix = scale === 1 ? "" : `@${scale}x`;
        void quality; // Figma JPG export doesn't expose quality param
        out[`${scale}x`] = this.push(bytes, `assets/${name}${suffix}.jpg`, "JPEG");
      } catch { /* skip */ }
    }
    return out;
  }

  async exportPdf(node: SceneNode): Promise<string | undefined> {
    try {
      const bytes = await (node as ExportMixin).exportAsync({ format: "PDF" });
      return this.push(bytes, `assets/${this.safeName(node)}.pdf`, "PDF");
    } catch {
      return undefined;
    }
  }

  // Export a node respecting the designer's own export settings in Figma
  // (set via the Export panel on the layer). This is the highest-priority
  // signal — it is explicit designer intent and overrides all heuristics.
  async exportFromSettings(
    node: SceneNode,
  ): Promise<{ primaryPath?: string; assets?: Record<string, string> }> {
    const settings = (node as ExportMixin).exportSettings;
    let primaryPath: string | undefined;
    const rasterAssets: Record<string, string> = {};
    const name = this.safeName(node);

    for (const s of settings) {
      try {
        // Build the correct exportAsync options per format (each has its own type).
        let exportOpts: ExportSettings;
        if (s.format === "SVG") {
          exportOpts = { format: "SVG" };
        } else if (s.format === "PDF") {
          exportOpts = { format: "PDF" };
        } else {
          exportOpts = {
            format: s.format as "PNG" | "JPG",
            constraint: (s as ExportSettingsImage).constraint,
          };
        }

        const bytes = await (node as ExportMixin).exportAsync(exportOpts);

        const constraint = (s as ExportSettingsImage).constraint;
        const scaleVal = constraint?.type === "SCALE" ? constraint.value : 1;
        const suffix = s.suffix || (scaleVal !== 1 ? `@${scaleVal}x` : "");

        let ext: string;
        let fmt: AssetFormat;
        switch (s.format) {
          case "SVG": ext = "svg"; fmt = "SVG"; break;
          case "JPG": ext = "jpg"; fmt = "JPEG"; break;
          case "PDF": ext = "pdf"; fmt = "PDF"; break;
          default:    ext = "png"; fmt = "PNG";
        }

        const path = `assets/${name}${suffix}.${ext}`;
        const pushed = this.push(bytes, path, fmt);
        if (!primaryPath) primaryPath = pushed;
        if (fmt === "PNG" || fmt === "JPEG") {
          rasterAssets[`${scaleVal}x`] = pushed;
        }
      } catch { /* skip this setting */ }
    }

    return {
      primaryPath,
      assets: Object.keys(rasterAssets).length ? rasterAssets : undefined,
    };
  }

  // Export a node in the given formats/scales (plugin-configured defaults).
  async exportAll(
    node: SceneNode,
    formats: AssetFormat[],
    pngScales: number[],
    jpegScales: number[],
  ): Promise<{ primaryPath?: string; assets?: Record<string, string> }> {
    const { jpegQuality } = this.options;
    let primaryPath: string | undefined;
    const rasterAssets: Record<string, string> = {};

    for (const fmt of formats) {
      if (fmt === "SVG") {
        const p = await this.exportSvg(node);
        if (p && !primaryPath) primaryPath = p;
      }
      if (fmt === "PNG") {
        const paths = await this.exportPng(node, pngScales);
        Object.assign(rasterAssets, paths);
        if (!primaryPath) primaryPath = paths[`${pngScales[0]}x`];
      }
      if (fmt === "JPEG") {
        const paths = await this.exportJpeg(node, jpegScales, jpegQuality);
        for (const [k, v] of Object.entries(paths)) rasterAssets[`jpeg-${k}`] = v;
        if (!primaryPath) primaryPath = paths[`${jpegScales[0]}x`];
      }
      if (fmt === "PDF") {
        const p = await this.exportPdf(node);
        if (p && !primaryPath) primaryPath = p;
      }
    }

    return {
      primaryPath,
      assets: Object.keys(rasterAssets).length ? rasterAssets : undefined,
    };
  }
}

// ─── Asset detection ──────────────────────────────────────────────────────────
//
// Priority order (highest to lowest):
//
//  1. Designer set export settings on the layer in Figma's Export panel
//     → exportFromSettings() — exact format/scale the designer specified.
//     Works for ANY node type, any name. This is the recommended way.
//
//  2. Node has an image fill (fill.type === "IMAGE")
//     → export using imageFormats/imagePngScales/imageJpegScales.
//     Catches hero images, photo backgrounds, product images.
//
//  3. Node type is a primitive vector shape (VECTOR, BOOLEAN_OPERATION, etc.)
//     → export using iconFormats/iconPngScales/iconJpegScales.
//     Always a vector — no ambiguity.
//
//  4. Node name matches /icon|logo|glyph/i AND type is INSTANCE or GROUP
//     → export using iconFormats. Last resort — brittle, depends on naming.
//     Example: "sign up/login icons", "icon-search", "logo-google".
//
// FRAMES are never treated as asset leaves (even with export settings set)
// because a FRAME is layout — it has children Claude needs to understand.
// Its children are walked and may themselves be detected as assets.
//
// ─────────────────────────────────────────────────────────────────────────────

// Returns true if the designer explicitly marked this node for export in
// Figma's Export panel — the highest-confidence signal.
export function hasDesignerExportSettings(node: SceneNode): boolean {
  return (
    "exportSettings" in node &&
    node.exportSettings.length > 0
  );
}

// Returns true for primitive vector types — always an icon/vector asset.
export function isVectorType(node: SceneNode): boolean {
  return (
    node.type === "VECTOR" ||
    node.type === "BOOLEAN_OPERATION" ||
    node.type === "STAR" ||
    node.type === "POLYGON"
  );
}

// Returns true for icon-named INSTANCE or GROUP nodes — name heuristic fallback.
export function isIconNamed(node: SceneNode): boolean {
  return (
    /icon|logo|glyph/i.test(node.name) &&
    (node.type === "INSTANCE" || node.type === "GROUP")
  );
}

// Does the node have a raster image fill?
export function hasImageFill(node: SceneNode): boolean {
  if (!("fills" in node)) return false;
  const fills = (node as GeometryMixin).fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return false;
  return fills.some((f) => f.visible !== false && f.type === "IMAGE");
}
