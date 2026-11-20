// fetch-assets.ts: installs a scene's binary assets (models, textures),
// which are not in git, from the OriginGame asset store where origin-engine
// pins them (public objects, addressed by sha256), each checked against the
// pin in origin/<scene>/og-assets.json (SCENE, default the-last-light). Files already in place with the
// right sha256 are kept.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const STORE = (process.env.OG_ASSETS_URL ?? "https://origingame.ai").replace(/\/+$/, "");
const project = join(import.meta.dir, "..", "origin", process.env.SCENE ?? "the-last-light");
const { files } = JSON.parse(readFileSync(join(project, "og-assets.json"), "utf8")) as { files: { path: string; sha256: string; size: number }[] };
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let fetched = 0;
for (const pin of files) {
  const to = join(project, pin.path);
  if (existsSync(to) && sha256(readFileSync(to)) === pin.sha256) continue;
  const res = await fetch(`${STORE}/api/engine-assets/sha256/${pin.sha256}`);
  if (!res.ok) throw new Error(`${pin.path}: the store answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (sha256(bytes) !== pin.sha256 || bytes.length !== pin.size) throw new Error(`${pin.path}: the download does not match its pin`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, bytes);
  fetched++;
}
console.error(`fetch-assets: ${files.length} pinned files in place (${fetched} downloaded)`);
