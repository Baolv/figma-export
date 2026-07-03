import { buildBundle } from "./lib/serialize";
import { ExportOptions } from "./lib/types";

figma.showUI(__html__, { width: 360, height: 580, themeColors: true });

async function collectModes(): Promise<string[]> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const names = new Set<string>();
  for (const c of collections) for (const m of c.modes) names.add(m.name);
  return Array.from(names);
}

figma.ui.onmessage = async (msg: {
  type: string;
  options?: ExportOptions;
  message?: string;
}) => {
  if (msg.type === "ready") {
    figma.ui.postMessage({
      type: "init",
      fileName: figma.root.name,
      selectionCount: figma.currentPage.selection.length,
      modes: await collectModes(),
    });
    return;
  }

  if (msg.type === "export" && msg.options) {
    const options = msg.options;
    try {
      const bundle = await buildBundle(options, (message, pct) => {
        figma.ui.postMessage({ type: "progress", message, pct });
      });
      // Hand off to the UI iframe to create and download the ZIP.
      figma.ui.postMessage({ type: "download", bundle });
    } catch (e) {
      figma.ui.postMessage({ type: "error", message: (e as Error).message });
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
