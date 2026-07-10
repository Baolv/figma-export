import { ComponentRecord, NodeRecord } from "./types";

export type BuildTree = (node: SceneNode) => Promise<NodeRecord>;

// Parse variant options from a component set's children (child names look like
// "size=large, state=default").
function collectVariantProps(
  set: ComponentSetNode,
): Record<string, string[]> {
  const props: Record<string, Set<string>> = {};
  for (const child of set.children) {
    if (child.type !== "COMPONENT") continue;
    for (const part of child.name.split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim());
      if (!k || v === undefined) continue;
      (props[k] ||= new Set()).add(v);
    }
  }
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(props)) out[k] = Array.from(props[k]);
  return out;
}

// Registry of all components referenced anywhere in the export. A component is
// defined ONCE here (its full anatomy); views reference it by id.
export class ComponentRegistry {
  private records = new Map<string, ComponentRecord>();
  private inProgress = new Set<string>();

  all(): Record<string, ComponentRecord> {
    const out: Record<string, ComponentRecord> = {};
    for (const [id, rec] of this.records) out[id] = rec;
    return out;
  }

  // Ensure a component (or its parent set) is registered. Returns the id a view
  // should reference. Transitive: buildTree may encounter nested instances,
  // which call ensure() again.
  async ensure(comp: ComponentNode, buildTree: BuildTree): Promise<string> {
    const set =
      comp.parent && comp.parent.type === "COMPONENT_SET"
        ? (comp.parent as ComponentSetNode)
        : null;
    const defId = set ? set.id : comp.id;
    if (this.records.has(defId) || this.inProgress.has(defId)) return defId;

    this.inProgress.add(defId);

    // Anatomy: the default variant for a set, else the component itself.
    const anatomy: SceneNode = set
      ? set.defaultVariant ?? (set.children[0] as SceneNode)
      : comp;
    const tree = await buildTree(anatomy);

    // Preview render at natural size — view screenshots are downscaled, so
    // small components (icons, buttons) need their own legible image.
    let preview: string | undefined;
    try {
      const wide = "width" in anatomy && (anatomy as LayoutMixin).width > 800;
      const bytes = await (anatomy as ExportMixin).exportAsync(
        wide
          ? { format: "PNG", constraint: { type: "WIDTH", value: 800 } }
          : { format: "PNG" },
      );
      preview = figma.base64Encode(bytes);
    } catch {
      /* preview is optional — ui reports the count of missing previews */
    }

    const rec: ComponentRecord = {
      id: defId,
      key: (set ? set.key : comp.key) || defId,
      name: set ? set.name : comp.name,
      description: (set ? set.description : comp.description) || undefined,
      tree,
      preview,
    };
    if (set) rec.variantProps = collectVariantProps(set);

    this.records.set(defId, rec);
    this.inProgress.delete(defId);
    return defId;
  }
}
