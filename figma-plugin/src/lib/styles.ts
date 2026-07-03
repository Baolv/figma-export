import { ColorRef, EffectInfo, FontInfo, StyleBundle } from "./types";
import { colorRefFromSolid, num, toTokenPath } from "./util";

export interface ResolvedStyles {
  bundle: StyleBundle;
  nameById: Map<string, string>; // styleId -> "text.heading-1"
}

export function effectToRecord(e: Effect): EffectInfo {
  const anyE = e as DropShadowEffect;
  const rec: EffectInfo = { type: e.type };
  if ("color" in anyE && anyE.color) {
    const c = anyE.color;
    rec.color = {
      hex: colorRefFromSolid(
        { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a } as SolidPaint,
      ).hex,
      opacity: c.a,
    };
  }
  if ("offset" in anyE && anyE.offset) rec.offset = { x: anyE.offset.x, y: anyE.offset.y };
  if ("radius" in anyE) rec.radius = anyE.radius;
  if ("spread" in anyE) rec.spread = (anyE as DropShadowEffect).spread;
  return rec;
}

export function fontFromTextStyle(s: TextStyle): FontInfo {
  const lh =
    s.lineHeight.unit === "AUTO"
      ? "auto"
      : s.lineHeight.unit === "PERCENT"
        ? (s.lineHeight.value / 100) * s.fontSize
        : s.lineHeight.value;
  const ls =
    s.letterSpacing.unit === "PERCENT"
      ? (s.letterSpacing.value / 100) * s.fontSize
      : s.letterSpacing.value;
  return {
    family: s.fontName.family,
    style: s.fontName.style,
    size: s.fontSize,
    lineHeight: lh,
    letterSpacing: ls,
    textCase: s.textCase,
    textDecoration: s.textDecoration,
  };
}

export async function resolveStyles(): Promise<ResolvedStyles> {
  const paintStyles = await figma.getLocalPaintStylesAsync();
  const textStyles = await figma.getLocalTextStylesAsync();
  const effectStyles = await figma.getLocalEffectStylesAsync();

  const bundle: StyleBundle = { colors: {}, text: {}, effects: {} };
  const nameById = new Map<string, string>();

  for (const s of paintStyles) {
    const token = toTokenPath(s.name);
    nameById.set(s.id, token);
    const refs: ColorRef[] = [];
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

  void num; // reserved for future numeric style handling
  return { bundle, nameById };
}
