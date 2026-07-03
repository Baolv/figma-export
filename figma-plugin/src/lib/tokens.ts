import { TokenBundle } from "./types";
import { toHex, toTokenPath } from "./util";

// Result of resolving all local variables: the token bundle for output, plus a
// lookup (variableId -> semantic token path) used elsewhere to attach token
// names to bound fills/spacing.
export interface ResolvedTokens {
  bundle: TokenBundle;
  nameById: Map<string, string>; // variableId -> "color.primary"
}

type AnyValue =
  | RGBA
  | number
  | string
  | boolean
  | VariableAlias
  | { r: number; g: number; b: number; a?: number };

function isAlias(v: unknown): v is VariableAlias {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as VariableAlias).type === "VARIABLE_ALIAS"
  );
}

export async function resolveTokens(
  requestedModes: string[] | null,
): Promise<ResolvedTokens> {
  const collections =
    await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const byId = new Map<string, Variable>();
  variables.forEach((v) => byId.set(v.id, v));

  const nameById = new Map<string, string>();
  variables.forEach((v) => nameById.set(v.id, toTokenPath(v.name)));

  const bundle: TokenBundle = {
    colors: {},
    numbers: {},
    strings: {},
    booleans: {},
    modes: [],
  };
  const modeSet = new Set<string>();

  // Map modeId -> mode name per collection, so token values are keyed by a
  // readable mode name ("light"/"dark").
  const modeName = new Map<string, string>();
  for (const col of collections) {
    for (const m of col.modes) modeName.set(m.modeId, m.name);
  }

  // Resolve a variable's value in a given mode, following alias chains.
  const resolve = (
    variable: Variable,
    modeId: string,
    seen = new Set<string>(),
  ): AnyValue | undefined => {
    if (seen.has(variable.id)) return undefined; // cycle guard
    seen.add(variable.id);
    // pick this mode's value, or fall back to the first available mode
    let raw = variable.valuesByMode[modeId];
    if (raw === undefined) {
      const first = Object.keys(variable.valuesByMode)[0];
      raw = variable.valuesByMode[first];
    }
    if (isAlias(raw)) {
      const target = byId.get(raw.id);
      if (!target) return undefined;
      return resolve(target, modeId, seen);
    }
    return raw as AnyValue;
  };

  for (const variable of variables) {
    const token = toTokenPath(variable.name);
    const col = collections.find(
      (c) => c.id === variable.variableCollectionId,
    );
    if (!col) continue;

    for (const mode of col.modes) {
      const mName = mode.name;
      if (requestedModes && !requestedModes.includes(mName)) continue;
      modeSet.add(mName);

      const value = resolve(variable, mode.modeId);
      if (value === undefined) continue;

      switch (variable.resolvedType) {
        case "COLOR": {
          const c = value as { r: number; g: number; b: number; a?: number };
          (bundle.colors[token] ||= {})[mName] = toHex(
            c.r,
            c.g,
            c.b,
            c.a ?? 1,
          );
          break;
        }
        case "FLOAT":
          (bundle.numbers[token] ||= {})[mName] = value as number;
          break;
        case "STRING":
          (bundle.strings[token] ||= {})[mName] = value as string;
          break;
        case "BOOLEAN":
          (bundle.booleans[token] ||= {})[mName] = value as boolean;
          break;
      }
    }
  }

  bundle.modes = Array.from(modeSet);
  return { bundle, nameById };
}
