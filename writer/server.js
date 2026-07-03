#!/usr/bin/env node
// Tiny, dependency-free local helper. Figma plugins are sandboxed and cannot
// write to the filesystem, so the plugin POSTs its export bundle here and this
// process writes the normalized structure under ~/figma-exports/<file_key>/.

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3777;
const ROOT = path.join(os.homedir(), "figma-exports");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// URL node-ids use "-" (e.g. 456-789) but Figma node ids use ":" (456:789).
// Name files with the dashed form so a pasted URL maps straight to a file.
const dashed = (id) => String(id).replace(/:/g, "-");

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function saveBundle(bundle) {
  const fileKey = bundle.meta && bundle.meta.fileKey ? bundle.meta.fileKey : "local";
  const dir = path.join(ROOT, fileKey);

  // fresh export — clear any previous run for this file
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "views"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  // normalize view index to dashed ids so Claude can look up by URL node-id
  const viewIndex = {};
  for (const [name, id] of Object.entries(bundle.meta.viewIndex || {})) {
    viewIndex[name] = dashed(id);
  }
  writeJson(path.join(dir, "meta.json"), { ...bundle.meta, viewIndex });
  writeJson(path.join(dir, "tokens.json"), bundle.tokens || {});
  writeJson(path.join(dir, "styles.json"), bundle.styles || {});
  writeJson(path.join(dir, "components.json"), bundle.components || {});

  for (const view of bundle.views || []) {
    writeJson(path.join(dir, "views", dashed(view.nodeId) + ".json"), view);
  }

  for (const asset of bundle.assets || []) {
    const rel = asset.path.replace(/^\/+/, "");
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(asset.base64, "base64"));
  }

  return {
    path: dir,
    views: (bundle.views || []).length,
    components: Object.keys(bundle.components || {}).length,
    assets: (bundle.assets || []).length,
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method === "GET") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, root: ROOT }));
  }
  if (req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const bundle = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = saveBundle(bundle);
        console.log(
          `✓ ${bundle.meta.fileName} → ${result.path} ` +
            `(${result.views} views, ${result.components} components, ${result.assets} assets)`,
        );
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        console.error("✗ export failed:", e.message);
        res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  res.writeHead(405, CORS);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Figma export writer listening on http://localhost:${PORT}`);
  console.log(`Writing exports to ${ROOT}/<file_key>/`);
});
