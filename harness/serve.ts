// A static server for the benchmark pages. Every response is the file's
// brotli (quality 11) encoding when the browser accepts it, compressed once
// at start so compression never runs inside a measured page load. Pages are
// cross-origin isolated (COOP/COEP), which both engines get alike.
//
//   bun harness/serve.ts <root> [--port 8787]
//
// GET /__log returns every request served since the last GET /__reset, with
// the bytes sent, so the runner can sum what a page actually downloaded.
import { brotliCompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

/** Brotli encodings by the sha256 of their source, so a restart does not compress again. */
const CACHE = join(dirname(import.meta.dir), ".work", "brotli-cache");
mkdirSync(CACHE, { recursive: true });

const root = resolve(process.argv[2] ?? ".");
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 8787;
/** --no-isolation serves without COOP/COEP (a page that is not cross-origin isolated). */
const isolated = !process.argv.includes("--no-isolation");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
  ".ktx2": "image/ktx2", ".webmanifest": "application/manifest+json", ".ttf": "font/ttf", ".woff2": "font/woff2",
};

interface Entry { raw: Uint8Array; br: Uint8Array; type: string }
const files = new Map<string, Entry>();
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const raw = readFileSync(p);
    const cached = join(CACHE, createHash("sha256").update(raw).digest("hex") + ".br");
    let br: Uint8Array;
    if (existsSync(cached)) br = readFileSync(cached);
    else {
      br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      writeFileSync(cached, br);
    }
    files.set("/" + relative(root, p).split("\\").join("/"), { raw, br, type: TYPES[extname(p).toLowerCase()] ?? "application/octet-stream" });
  }
}
const t0 = performance.now();
walk(root);
console.error(`serve: ${files.size} files from ${root}, brotli-11 in ${Math.round(performance.now() - t0)} ms`);

let log: { path: string; status: number; raw: number; sent: number; encoding: string }[] = [];

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/__log") return Response.json(log);
    if (url.pathname === "/__reset") { log = []; return new Response("ok"); }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const f = files.get(path);
    const headers: Record<string, string> = isolated
      ? { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "public, max-age=3600" }
      : { "Cache-Control": "public, max-age=3600" };
    if (!f) { log.push({ path, status: 404, raw: 0, sent: 0, encoding: "" }); return new Response("not found", { status: 404, headers }); }
    const br = (req.headers.get("accept-encoding") ?? "").includes("br");
    const body = br ? f.br : f.raw;
    if (br) headers["Content-Encoding"] = "br";
    headers["Content-Type"] = f.type;
    log.push({ path, status: 200, raw: f.raw.length, sent: body.length, encoding: br ? "br" : "identity" });
    return new Response(body, { headers });
  },
});
console.error(`serve: http://127.0.0.1:${port}/`);
