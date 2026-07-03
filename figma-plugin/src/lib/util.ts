import { ColorRef, Padding, RGBA } from "./types";

export const isMixed = (v: unknown): boolean => v === figma.mixed;

export function toHex(r: number, g: number, b: number, a = 1): string {
  const c = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${c(r)}${c(g)}${c(b)}`;
  return a < 1 ? `${base}${c(a)}` : base;
}

export function rgbaFromPaint(color: RGB, opacity?: number): RGBA {
  return { r: color.r, g: color.g, b: color.b, a: opacity ?? 1 };
}

// Turn a Figma variable/style name ("color/brand/primary") into a dot token
// path ("color.brand.primary").
export function toTokenPath(name: string): string {
  return name
    .split("/")
    .map((s) => s.trim().replace(/\s+/g, "-").toLowerCase())
    .join(".");
}

export function paddingOf(node: {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}): Padding {
  return {
    t: node.paddingTop,
    r: node.paddingRight,
    b: node.paddingBottom,
    l: node.paddingLeft,
  };
}

export function num(v: number | symbol, fallback?: number): number | undefined {
  return isMixed(v) ? fallback : (v as number);
}

// Build a ColorRef from a solid paint, attaching a token name if the paint is
// bound to a variable we know about.
export function colorRefFromSolid(
  paint: SolidPaint,
  tokenName?: string,
): ColorRef {
  return {
    token: tokenName,
    hex: toHex(paint.color.r, paint.color.g, paint.color.b, paint.opacity ?? 1),
    opacity: paint.opacity,
  };
}
