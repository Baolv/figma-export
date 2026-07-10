"use strict";
(() => {
  // src/lib/assets.ts
  var AssetCollector = class {
    constructor(options) {
      this.options = options;
      this.assets = [];
      this.byHash = /* @__PURE__ */ new Map();
      // contentHash -> path
      this.usedNames = /* @__PURE__ */ new Set();
    }
    list() {
      return this.assets;
    }
    safeName(node) {
      const base = node.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "node";
      let name = base;
      let i = 1;
      while (this.usedNames.has(name)) name = `${base}-${i++}`;
      this.usedNames.add(name);
      return name;
    }
    // FNV-1a — cheap content hash for de-duplication.
    hash(bytes) {
      let h = 2166136261;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16);
    }
    push(bytes, path, format) {
      const key = `${format}:${this.hash(bytes)}:${bytes.length}`;
      const existing = this.byHash.get(key);
      if (existing) return existing;
      this.assets.push({ path, format, base64: figma.base64Encode(bytes) });
      this.byHash.set(key, path);
      return path;
    }
    // --- per-format exporters ---
    async exportSvg(node) {
      try {
        const bytes = await node.exportAsync({ format: "SVG" });
        return this.push(bytes, `assets/${this.safeName(node)}.svg`, "SVG");
      } catch (e) {
        return void 0;
      }
    }
    async exportPng(node, scales) {
      const out = {};
      const name = this.safeName(node);
      for (const scale of scales) {
        try {
          const bytes = await node.exportAsync({
            format: "PNG",
            constraint: { type: "SCALE", value: scale }
          });
          const suffix = scale === 1 ? "" : `@${scale}x`;
          out[`${scale}x`] = this.push(bytes, `assets/${name}${suffix}.png`, "PNG");
        } catch (e) {
        }
      }
      return out;
    }
    async exportJpeg(node, scales, quality) {
      const out = {};
      const name = this.safeName(node);
      for (const scale of scales) {
        try {
          const bytes = await node.exportAsync({
            format: "JPG",
            constraint: { type: "SCALE", value: scale }
          });
          const suffix = scale === 1 ? "" : `@${scale}x`;
          out[`${scale}x`] = this.push(bytes, `assets/${name}${suffix}.jpg`, "JPEG");
        } catch (e) {
        }
      }
      return out;
    }
    async exportPdf(node) {
      try {
        const bytes = await node.exportAsync({ format: "PDF" });
        return this.push(bytes, `assets/${this.safeName(node)}.pdf`, "PDF");
      } catch (e) {
        return void 0;
      }
    }
    // Export a node respecting the designer's own export settings in Figma
    // (set via the Export panel on the layer). This is the highest-priority
    // signal — it is explicit designer intent and overrides all heuristics.
    async exportFromSettings(node) {
      const settings = node.exportSettings;
      let primaryPath;
      const rasterAssets = {};
      const name = this.safeName(node);
      for (const s of settings) {
        try {
          let exportOpts;
          if (s.format === "SVG") {
            exportOpts = { format: "SVG" };
          } else if (s.format === "PDF") {
            exportOpts = { format: "PDF" };
          } else {
            exportOpts = {
              format: s.format,
              constraint: s.constraint
            };
          }
          const bytes = await node.exportAsync(exportOpts);
          const constraint = s.constraint;
          const scaleVal = (constraint == null ? void 0 : constraint.type) === "SCALE" ? constraint.value : 1;
          const suffix = s.suffix || (scaleVal !== 1 ? `@${scaleVal}x` : "");
          let ext;
          let fmt;
          switch (s.format) {
            case "SVG":
              ext = "svg";
              fmt = "SVG";
              break;
            case "JPG":
              ext = "jpg";
              fmt = "JPEG";
              break;
            case "PDF":
              ext = "pdf";
              fmt = "PDF";
              break;
            default:
              ext = "png";
              fmt = "PNG";
          }
          const path = `assets/${name}${suffix}.${ext}`;
          const pushed = this.push(bytes, path, fmt);
          if (!primaryPath) primaryPath = pushed;
          if (fmt === "PNG" || fmt === "JPEG") {
            rasterAssets[`${scaleVal}x`] = pushed;
          }
        } catch (e) {
        }
      }
      return {
        primaryPath,
        assets: Object.keys(rasterAssets).length ? rasterAssets : void 0
      };
    }
    // Export a node in the given formats/scales (plugin-configured defaults).
    async exportAll(node, formats, pngScales, jpegScales) {
      const { jpegQuality } = this.options;
      let primaryPath;
      const rasterAssets = {};
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
        assets: Object.keys(rasterAssets).length ? rasterAssets : void 0
      };
    }
  };
  function hasDesignerExportSettings(node) {
    return "exportSettings" in node && node.exportSettings.length > 0;
  }
  function isVectorType(node) {
    return node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "STAR" || node.type === "POLYGON";
  }
  function isIconNamed(node) {
    return /icon|logo|glyph/i.test(node.name) && (node.type === "INSTANCE" || node.type === "GROUP");
  }
  function hasImageFill(node) {
    if (!("fills" in node)) return false;
    const fills = node.fills;
    if (fills === figma.mixed || !Array.isArray(fills)) return false;
    return fills.some((f) => f.visible !== false && f.type === "IMAGE");
  }

  // src/lib/components.ts
  function collectVariantProps(set) {
    const props = {};
    for (const child of set.children) {
      if (child.type !== "COMPONENT") continue;
      for (const part of child.name.split(",")) {
        const [k, v] = part.split("=").map((s) => s.trim());
        if (!k || v === void 0) continue;
        (props[k] || (props[k] = /* @__PURE__ */ new Set())).add(v);
      }
    }
    const out = {};
    for (const k of Object.keys(props)) out[k] = Array.from(props[k]);
    return out;
  }
  var ComponentRegistry = class {
    constructor() {
      this.records = /* @__PURE__ */ new Map();
      this.inProgress = /* @__PURE__ */ new Set();
    }
    all() {
      const out = {};
      for (const [id, rec] of this.records) out[id] = rec;
      return out;
    }
    // Ensure a component (or its parent set) is registered. Returns the id a view
    // should reference. Transitive: buildTree may encounter nested instances,
    // which call ensure() again.
    async ensure(comp, buildTree) {
      var _a;
      const set = comp.parent && comp.parent.type === "COMPONENT_SET" ? comp.parent : null;
      const defId = set ? set.id : comp.id;
      if (this.records.has(defId) || this.inProgress.has(defId)) return defId;
      this.inProgress.add(defId);
      const anatomy = set ? (_a = set.defaultVariant) != null ? _a : set.children[0] : comp;
      const tree = await buildTree(anatomy);
      let preview;
      try {
        const wide = "width" in anatomy && anatomy.width > 800;
        const bytes = await anatomy.exportAsync(
          wide ? { format: "PNG", constraint: { type: "WIDTH", value: 800 } } : { format: "PNG" }
        );
        preview = figma.base64Encode(bytes);
      } catch (e) {
      }
      const rec = {
        id: defId,
        key: (set ? set.key : comp.key) || defId,
        name: set ? set.name : comp.name,
        description: (set ? set.description : comp.description) || void 0,
        tree,
        preview
      };
      if (set) rec.variantProps = collectVariantProps(set);
      this.records.set(defId, rec);
      this.inProgress.delete(defId);
      return defId;
    }
  };

  // src/lib/util.ts
  var isMixed = (v) => v === figma.mixed;
  function toHex(r, g, b, a = 1) {
    const c = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
    const base = `#${c(r)}${c(g)}${c(b)}`;
    return a < 1 ? `${base}${c(a)}` : base;
  }
  function toTokenPath(name) {
    return name.split("/").map((s) => s.trim().replace(/\s+/g, "-").toLowerCase()).join(".");
  }
  function paddingOf(node) {
    return {
      t: node.paddingTop,
      r: node.paddingRight,
      b: node.paddingBottom,
      l: node.paddingLeft
    };
  }
  function num(v, fallback) {
    return isMixed(v) ? fallback : v;
  }
  function colorRefFromSolid(paint, tokenName) {
    return {
      token: tokenName,
      // 6-digit #RRGGBB only — alpha is carried by the separate `opacity` field,
      // so consumers get a directly parseable hex (SwiftUI/CSS reject #RRGGBBAA).
      hex: toHex(paint.color.r, paint.color.g, paint.color.b),
      opacity: paint.opacity
    };
  }

  // src/lib/styles.ts
  function effectToRecord(e) {
    const anyE = e;
    const rec = { type: e.type };
    if ("color" in anyE && anyE.color) {
      const c = anyE.color;
      rec.color = {
        hex: colorRefFromSolid(
          { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }
        ).hex,
        opacity: c.a
      };
    }
    if ("offset" in anyE && anyE.offset) rec.offset = { x: anyE.offset.x, y: anyE.offset.y };
    if ("radius" in anyE) rec.radius = anyE.radius;
    if ("spread" in anyE) rec.spread = anyE.spread;
    return rec;
  }
  function fontFromTextStyle(s) {
    const lh = s.lineHeight.unit === "AUTO" ? "auto" : s.lineHeight.unit === "PERCENT" ? s.lineHeight.value / 100 * s.fontSize : s.lineHeight.value;
    const ls = s.letterSpacing.unit === "PERCENT" ? s.letterSpacing.value / 100 * s.fontSize : s.letterSpacing.value;
    return {
      family: s.fontName.family,
      style: s.fontName.style,
      size: s.fontSize,
      lineHeight: lh,
      letterSpacing: ls,
      textCase: s.textCase,
      textDecoration: s.textDecoration
    };
  }
  async function resolveStyles() {
    const paintStyles = await figma.getLocalPaintStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();
    const bundle = { colors: {}, text: {}, effects: {} };
    const nameById = /* @__PURE__ */ new Map();
    for (const s of paintStyles) {
      const token = toTokenPath(s.name);
      nameById.set(s.id, token);
      const refs = [];
      for (const p of s.paints) {
        if (p.type === "SOLID") refs.push(colorRefFromSolid(p, token));
      }
      bundle.colors[token] = refs;
    }
    for (const s of textStyles) {
      const token = toTokenPath(s.name);
      nameById.set(s.id, token);
      bundle.text[token] = fontFromTextStyle(s);
    }
    for (const s of effectStyles) {
      const token = toTokenPath(s.name);
      nameById.set(s.id, token);
      bundle.effects[token] = s.effects.map(effectToRecord);
    }
    return { bundle, nameById };
  }

  // src/lib/tokens.ts
  function isAlias(v) {
    return typeof v === "object" && v !== null && v.type === "VARIABLE_ALIAS";
  }
  async function resolveTokens(requestedModes) {
    var _a, _b, _c, _d, _e;
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const byId = /* @__PURE__ */ new Map();
    variables.forEach((v) => byId.set(v.id, v));
    const nameById = /* @__PURE__ */ new Map();
    variables.forEach((v) => nameById.set(v.id, toTokenPath(v.name)));
    const bundle = {
      colors: {},
      numbers: {},
      strings: {},
      booleans: {},
      modes: []
    };
    const modeSet = /* @__PURE__ */ new Set();
    const modeName = /* @__PURE__ */ new Map();
    for (const col of collections) {
      for (const m of col.modes) modeName.set(m.modeId, m.name);
    }
    const resolve = (variable, modeId, seen = /* @__PURE__ */ new Set()) => {
      if (seen.has(variable.id)) return void 0;
      seen.add(variable.id);
      let raw = variable.valuesByMode[modeId];
      if (raw === void 0) {
        const first = Object.keys(variable.valuesByMode)[0];
        raw = variable.valuesByMode[first];
      }
      if (isAlias(raw)) {
        const target = byId.get(raw.id);
        if (!target) return void 0;
        return resolve(target, modeId, seen);
      }
      return raw;
    };
    for (const variable of variables) {
      const token = toTokenPath(variable.name);
      const col = collections.find(
        (c) => c.id === variable.variableCollectionId
      );
      if (!col) continue;
      for (const mode of col.modes) {
        const mName = mode.name;
        if (requestedModes && !requestedModes.includes(mName)) continue;
        modeSet.add(mName);
        const value = resolve(variable, mode.modeId);
        if (value === void 0) continue;
        switch (variable.resolvedType) {
          case "COLOR": {
            const c = value;
            ((_a = bundle.colors)[token] || (_a[token] = {}))[mName] = toHex(
              c.r,
              c.g,
              c.b,
              (_b = c.a) != null ? _b : 1
            );
            break;
          }
          case "FLOAT":
            ((_c = bundle.numbers)[token] || (_c[token] = {}))[mName] = value;
            break;
          case "STRING":
            ((_d = bundle.strings)[token] || (_d[token] = {}))[mName] = value;
            break;
          case "BOOLEAN":
            ((_e = bundle.booleans)[token] || (_e[token] = {}))[mName] = value;
            break;
        }
      }
    }
    bundle.modes = Array.from(modeSet);
    return { bundle, nameById };
  }

  // src/lib/traverse.ts
  async function resolveStyleToken(styleId, ctx) {
    var _a;
    if (!styleId) return void 0;
    const cached = (_a = ctx.styleNameById.get(styleId)) != null ? _a : ctx.styleCache.get(styleId);
    if (cached) return cached;
    try {
      const style = await figma.getStyleByIdAsync(styleId);
      if (style) {
        const token = toTokenPath(style.name);
        ctx.styleCache.set(styleId, token);
        return token;
      }
    } catch (e) {
    }
    return void 0;
  }
  async function resolveColorRefs(node, ctx) {
    var _a;
    if (!("fills" in node)) return [];
    const fills = node.fills;
    if (fills === figma.mixed || !Array.isArray(fills)) return [];
    const rawStyleId = "fillStyleId" in node ? node.fillStyleId : "";
    const styleId = typeof rawStyleId === "string" ? rawStyleId : "";
    const styleToken = await resolveStyleToken(styleId, ctx);
    const bound = (_a = node.boundVariables) == null ? void 0 : _a.fills;
    const out = [];
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
  async function getFont(t, ctx) {
    const font = { family: "", style: "" };
    if (!isMixed(t.fontName)) {
      font.family = t.fontName.family;
      font.style = t.fontName.style;
    }
    if (!isMixed(t.fontSize)) font.size = t.fontSize;
    if (!isMixed(t.fontWeight)) font.weight = t.fontWeight;
    if (!isMixed(t.lineHeight)) {
      const lh = t.lineHeight;
      font.lineHeight = lh.unit === "AUTO" ? "auto" : lh.unit === "PERCENT" ? lh.value / 100 * (font.size || 0) : lh.value;
    }
    if (!isMixed(t.letterSpacing)) {
      const ls = t.letterSpacing;
      font.letterSpacing = ls.unit === "PERCENT" ? ls.value / 100 * (font.size || 0) : ls.value;
    }
    if (!isMixed(t.textCase)) font.textCase = t.textCase;
    if (!isMixed(t.textDecoration)) font.textDecoration = t.textDecoration;
    font.align = t.textAlignHorizontal;
    const sid = t.textStyleId;
    if (typeof sid === "string" && sid) {
      const tok = await resolveStyleToken(sid, ctx);
      if (tok) font.token = tok;
    }
    return font;
  }
  function getLayout(node) {
    const layout = { mode: "NONE" };
    if ("layoutMode" in node) {
      const n = node;
      layout.mode = n.layoutMode;
      if (n.layoutMode === "HORIZONTAL" || n.layoutMode === "VERTICAL") {
        layout.itemSpacing = n.itemSpacing;
        layout.padding = paddingOf(n);
        layout.primaryAxisAlign = n.primaryAxisAlignItems;
        layout.counterAxisAlign = n.counterAxisAlignItems;
        if (n.layoutWrap === "WRAP") layout.wrap = true;
      } else if (n.layoutMode === "GRID") {
        const g = n;
        if (typeof g.gridRowCount === "number") layout.gridRowCount = g.gridRowCount;
        if (typeof g.gridColumnCount === "number") layout.gridColumnCount = g.gridColumnCount;
        if (typeof g.gridRowGap === "number") layout.gridRowGap = g.gridRowGap;
        if (typeof g.gridColumnGap === "number") layout.gridColumnGap = g.gridColumnGap;
        layout.padding = paddingOf(n);
      }
    }
    try {
      if ("layoutSizingHorizontal" in node) {
        const n = node;
        layout.sizingH = n.layoutSizingHorizontal;
        layout.sizingV = n.layoutSizingVertical;
      }
    } catch (e) {
    }
    if (layout.mode === "NONE" && !layout.sizingH) return void 0;
    return layout;
  }
  function componentPropsOf(inst) {
    const props = {};
    try {
      const cp = inst.componentProperties;
      for (const key of Object.keys(cp)) {
        const name = key.split("#")[0];
        props[name] = String(cp[key].value);
      }
    } catch (e) {
    }
    return props;
  }
  function textOverridesOf(inst) {
    const out = {};
    try {
      const texts = inst.findAllWithCriteria({ types: ["TEXT"] });
      for (const t of texts) {
        if (typeof t.characters === "string" && t.characters) out[t.name] = t.characters;
      }
    } catch (e) {
    }
    return out;
  }
  async function applyVisualProps(rec, node, ctx) {
    const fills = await resolveColorRefs(node, ctx);
    if (fills.length) rec.fills = fills;
    if ("strokes" in node) {
      const strokes = node.strokes;
      if (Array.isArray(strokes) && strokes.length) {
        const refs = strokes.filter((s) => s.visible !== false && s.type === "SOLID").map((s) => colorRefFromSolid(s));
        if (refs.length) rec.strokes = refs;
        const sw = node.strokeWeight;
        if (!isMixed(sw)) rec.strokeWeight = sw;
      }
    }
    if ("cornerRadius" in node) {
      const cr = node.cornerRadius;
      if (!isMixed(cr) && typeof cr === "number" && cr > 0) {
        rec.cornerRadius = cr;
      } else if (isMixed(cr) && "topLeftRadius" in node) {
        const n = node;
        rec.cornerRadius = {
          t: n.topLeftRadius,
          r: n.topRightRadius,
          b: n.bottomRightRadius,
          l: n.bottomLeftRadius
        };
      }
    }
    if ("effects" in node) {
      const effects = node.effects;
      if (effects.length) {
        rec.effects = effects.filter((e) => e.visible !== false).map((e) => effectToRecord(e));
      }
    }
  }
  async function exportAsset(node, rec, ctx) {
    const isFrame = node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET";
    if (ctx.options.assetMode === "settings-only") {
      if (hasDesignerExportSettings(node)) {
        const { primaryPath, assets } = await ctx.assets.exportFromSettings(node);
        if (primaryPath) {
          rec.asset = primaryPath;
          if (assets) rec.assets = assets;
          if (!isFrame) return true;
        }
      }
      return false;
    }
    if (hasDesignerExportSettings(node)) {
      const { primaryPath, assets } = await ctx.assets.exportFromSettings(node);
      if (primaryPath) {
        rec.asset = primaryPath;
        if (assets) rec.assets = assets;
      }
      if (!isFrame) return true;
    }
    if (hasImageFill(node)) {
      const o = ctx.options;
      const { primaryPath, assets } = await ctx.assets.exportAll(
        node,
        o.imageFormats,
        o.imagePngScales,
        o.imageJpegScales
      );
      if (primaryPath) rec.asset = primaryPath;
      if (assets) rec.assets = assets;
      return false;
    }
    if (isVectorType(node)) {
      const o = ctx.options;
      const { primaryPath, assets } = await ctx.assets.exportAll(
        node,
        o.iconFormats,
        o.iconPngScales,
        o.iconJpegScales
      );
      if (primaryPath) {
        rec.asset = primaryPath;
        if (assets) rec.assets = assets;
        return true;
      }
    }
    if (isIconNamed(node)) {
      const o = ctx.options;
      const { primaryPath, assets } = await ctx.assets.exportAll(
        node,
        o.iconFormats,
        o.iconPngScales,
        o.iconJpegScales
      );
      if (primaryPath) {
        rec.asset = primaryPath;
        if (assets) rec.assets = assets;
        return true;
      }
    }
    return false;
  }
  async function nodeToRecord(node, ctx) {
    const rec = { id: node.id, name: node.name, type: node.type };
    if (node.visible === false) rec.visible = false;
    if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
      const b = node.absoluteBoundingBox;
      rec.box = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    if ("opacity" in node && node.opacity !== 1) {
      rec.opacity = node.opacity;
    }
    if (node.type === "INSTANCE") {
      const inst = node;
      const main = await inst.getMainComponentAsync();
      if (main) {
        rec.componentId = await ctx.registry.ensure(main, (n) => nodeToRecord(n, ctx));
        rec.component = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent.name : main.name;
      }
      const props = componentPropsOf(inst);
      if (Object.keys(props).length) rec.props = props;
      const overrides = textOverridesOf(inst);
      if (Object.keys(overrides).length) rec.overrides = overrides;
      rec.layout = getLayout(node);
      await exportAsset(node, rec, ctx);
      return rec;
    }
    if (node.type === "TEXT") {
      const t = node;
      if (t.characters) rec.text = t.characters;
      rec.font = await getFont(t, ctx);
      const colors = await resolveColorRefs(t, ctx);
      if (colors.length) rec.color = colors[0];
      return rec;
    }
    const isLeaf = await exportAsset(node, rec, ctx);
    if (isLeaf) return rec;
    await applyVisualProps(rec, node, ctx);
    rec.layout = getLayout(node);
    if ("children" in node) {
      const kids = [];
      for (const child of node.children) {
        kids.push(await nodeToRecord(child, ctx));
      }
      if (kids.length) rec.children = kids;
    }
    return rec;
  }

  // src/lib/serialize.ts
  var CONTAINER_TYPES = /* @__PURE__ */ new Set([
    "FRAME",
    "COMPONENT",
    "COMPONENT_SET",
    "INSTANCE",
    "GROUP",
    "SECTION"
  ]);
  function isScreenFrame(node) {
    if (node.type !== "FRAME") return false;
    const f = node;
    if (f.children.length === 0) return false;
    const w = f.width;
    const h = f.height;
    return w >= 200 && w <= 1440 && h >= 320 && h <= 3e3;
  }
  function collectScreenFrames(section, acc) {
    for (const child of section.children) {
      if (isScreenFrame(child)) acc.push(child);
      else if (child.type === "SECTION") collectScreenFrames(child, acc);
    }
  }
  function targetsForScope(scope) {
    switch (scope) {
      case "selection":
        return [...figma.currentPage.selection];
      case "page":
        return figma.currentPage.children.filter(
          (n) => CONTAINER_TYPES.has(n.type)
        );
      case "top-frames":
        return figma.currentPage.children.filter(
          (n) => n.type === "FRAME"
        );
      case "file": {
        const out = [];
        for (const page of figma.root.children) {
          for (const n of page.children) {
            if (n.type === "FRAME") out.push(n);
          }
        }
        return out;
      }
    }
  }
  function buildNodeIndex(views) {
    const index = {};
    function walk(node, viewId) {
      index[node.id.replace(/:/g, "-")] = viewId;
      for (const child of node.children || []) walk(child, viewId);
    }
    for (const view of views) {
      const viewId = String(view.nodeId).replace(/:/g, "-");
      walk(view.tree, viewId);
    }
    return index;
  }
  function pageNameOf(node) {
    let p = node;
    while (p && p.type !== "PAGE") p = p.parent;
    return p ? p.name : "";
  }
  async function buildBundle(options, progress) {
    await figma.loadAllPagesAsync();
    progress("Resolving design tokens\u2026", 5);
    const tokens = await resolveTokens(options.modes);
    progress("Resolving styles\u2026", 15);
    const styles = await resolveStyles();
    const registry = new ComponentRegistry();
    const assets = new AssetCollector(options);
    const ctx = {
      varNameById: tokens.nameById,
      styleNameById: styles.nameById,
      styleCache: /* @__PURE__ */ new Map(),
      // live cache for library style lookups
      registry,
      assets,
      options
    };
    const targets = targetsForScope(options.scope);
    if (targets.length === 0) {
      throw new Error(
        options.scope === "selection" ? "Nothing selected. Select a frame, or choose a different scope." : "No frames found for the chosen scope."
      );
    }
    const seen = new Set(targets.map((t) => t.id));
    const screens = [];
    for (const t of targets) {
      if (t.type === "SECTION") collectScreenFrames(t, screens);
    }
    const allTargets = [...targets, ...screens.filter((s) => !seen.has(s.id))];
    const views = [];
    const viewIndex = {};
    for (let i = 0; i < allTargets.length; i++) {
      const node = allTargets[i];
      progress(
        `Exporting "${node.name}" (${i + 1}/${allTargets.length})\u2026`,
        20 + Math.round(60 * i / allTargets.length)
      );
      const tree = await nodeToRecord(node, ctx);
      let preview;
      if (node.type !== "SECTION") {
        try {
          const wide = "width" in node && node.width > 800;
          const bytes = await node.exportAsync(
            wide ? { format: "PNG", constraint: { type: "WIDTH", value: 800 } } : { format: "PNG" }
          );
          preview = figma.base64Encode(bytes);
        } catch (e) {
        }
      }
      views.push({ nodeId: node.id, page: pageNameOf(node), tree, preview });
      viewIndex[node.name] = node.id.replace(/:/g, "-");
    }
    progress("Packaging bundle\u2026", 90);
    const bundle = {
      meta: {
        fileKey: figma.fileKey || figma.root.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "local",
        fileName: figma.root.name,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        exportedFrom: options.scope === "file" ? "file" : figma.currentPage.name,
        scope: options.scope,
        pages: figma.root.children.map((p) => p.name),
        viewIndex
      },
      tokens: tokens.bundle,
      styles: styles.bundle,
      components: registry.all(),
      views,
      assets: assets.list(),
      nodeIndex: buildNodeIndex(views)
    };
    return bundle;
  }

  // src/code.ts
  figma.showUI(__html__, { width: 360, height: 580, themeColors: true });
  async function collectModes() {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const names = /* @__PURE__ */ new Set();
    for (const c of collections) for (const m of c.modes) names.add(m.name);
    return Array.from(names);
  }
  figma.ui.onmessage = async (msg) => {
    if (msg.type === "ready") {
      figma.ui.postMessage({
        type: "init",
        fileName: figma.root.name,
        selectionCount: figma.currentPage.selection.length,
        modes: await collectModes()
      });
      return;
    }
    if (msg.type === "export" && msg.options) {
      const options = msg.options;
      try {
        const bundle = await buildBundle(options, (message, pct) => {
          figma.ui.postMessage({ type: "progress", message, pct });
        });
        figma.ui.postMessage({ type: "download", bundle });
      } catch (e) {
        figma.ui.postMessage({ type: "error", message: e.message });
      }
      return;
    }
    if (msg.type === "done") {
      figma.notify(msg.message || "Export complete");
      return;
    }
    if (msg.type === "close") {
      figma.closePlugin();
    }
  };
})();
