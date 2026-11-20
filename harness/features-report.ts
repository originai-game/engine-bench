// features-report.ts <results/<name>/features>: the feature section from
// scripts/features.sh's held runs. Writes features.md (the README's section,
// copied in by hand), features.json (every number) and crops/<feature>.png
// (Origin left, three.js right, 1:1 pixels of the 2560 x 1440 frames).
//
// A feature's cost is Origin's held frame with it minus without it, at the
// same path time, per round:
// - GPU ms per frame: the median interval between the GPU finishing one
//   frame and the next (onSubmittedWorkDone), the GPU's time per frame while
//   it limits the frame rate;
// - frame ms: the median interval between frames.
// The three.js lines are counted from three/src/the-last-light.ts between
// its `// bench-feature <name>` and `// bench-feature end` markers: lines
// that are neither blank nor only a comment.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) throw new Error("usage: features-report.ts <results/<name>/features>");

type How = "shipped addon" | "hand-written" | "not possible" | "not ported";
interface Feature {
  key: string; title: string; at: number; origin: string;
  how: How; three: string; lines?: string; crop: [number, number, number, number];
}
// crop: x, y, width, height in the 2560 x 1440 frame.
const FEATURES: Feature[] = [
  { key: "clouds", title: "Volumetric clouds", at: 8, origin: "og.Clouds: ray-marched (96 steps), lit by the sun and the sky, shadowing the land", how: "shipped addon", three: "SkyMesh's cloud layer: 2D noise on the sky dome, no volume, no shadows", crop: [1280, 0, 1280, 720] },
  { key: "exposure", title: "Auto exposure", at: 12, origin: "RenderSettings.autoExposure: a metered, adapting exposure (cinematic-realism)", how: "not possible", three: "no exposure meter in three.js; the page holds exposure 2, set to Origin's brightness on the cover", crop: [640, 360, 1280, 720] },
  { key: "sky", title: "Physical sky", at: 8, origin: "og.PhysicalSky: Hillaire 2020 atmosphere, multiple scattering, the sky's light and the sun's colour from it", how: "shipped addon", three: "SkyMesh (Preetham 1999 analytic sky) and a PMREM of it for the sky's light", crop: [0, 0, 1280, 720] },
  { key: "taa", title: "TAA (Origin) vs 4x MSAA (three.js)", at: 0.5, origin: "TAA: jittered frames and a reprojected history; Origin's default in 3D", how: "shipped addon", three: "4x MSAA, three.js's default (pass samples 4); three.js also ships TRAANode, unused at its defaults", crop: [1280, 720, 640, 360] },
  { key: "cloth", title: "Cloth (the cloak)", at: 16, origin: "og.Garment: the cloak simulated, pinned at the collar, in the wind", how: "not possible", three: "no cloth in three.js; the cloak is the skinned mesh as the clip poses it", crop: [640, 360, 1280, 720] },
  { key: "rope", title: "Rope (the lantern cord)", at: 16, origin: "og.Rope: a 6-segment cord the lantern hangs from", how: "hand-written", three: "a still cylinder in the cord's place, no physics", lines: "rope", crop: [960, 540, 640, 360] },
  { key: "wind", title: "Wind on the plants", at: 0.5, origin: "TerrainScatter.sway: og.Wind sways the five plant layers", how: "hand-written", three: "Origin's scatter_sway (lean 0.05 of the height per m/s, gust 0.6) in each plant's vertex shader; counted with the scatter's lines", crop: [1280, 720, 1280, 720] },
  { key: "sea", title: "The sea", at: 12, origin: "og.Water: FFT waves, shoaling swell, shore foam, reflections and refraction", how: "hand-written", three: "four Gerstner waves on a grid that follows the camera, depth colour and shore foam; reflects the sky's light only", lines: "sea", crop: [1280, 720, 1280, 720] },
  { key: "seafx", title: "The sea's foam streaks and spray", at: 12, origin: "og.Water foamStreaks and spray: windrows of ageing foam, droplets off the crests", how: "not possible", three: "none", crop: [1280, 720, 1280, 720] },
  { key: "grass", title: "Grass (700 a square metre to 120 m)", at: 0.5, origin: "og.Grass: blades generated on the GPU every frame, three levels of detail, wind", how: "hand-written", three: "og.Grass's scheme as InstancedMesh per 16 m chunk, placed in the vertex shader", lines: "grass", crop: [1280, 720, 1280, 720] },
  { key: "scatter", title: "The five plant layers", at: 0.5, origin: "og.TerrainScatter x5: placed by rules on the GPU, culled per copy", how: "hand-written", three: "og.TerrainScatter's placement rules on the CPU at load, InstancedMesh per 16 m chunk", lines: "scatter", crop: [1280, 720, 1280, 720] },
];

// --- the three.js lines -------------------------------------------------------
const page = readFileSync(join(import.meta.dir, "..", "three", "src", "the-last-light.ts"), "utf8").split("\n");
const lines: Record<string, number> = {};
let open: string | null = null;
for (const line of page) {
  const m = line.match(/\/\/ bench-feature (\S+)/);
  if (m) { open = m[1] === "end" ? null : m[1]!; if (open) lines[open] = 0; continue; }
  const t = line.trim();
  if (open && t && !t.startsWith("//")) lines[open]!++;
}

// --- the runs -------------------------------------------------------------------
const rounds = ["r1", "r2"].filter((r) => existsSync(join(dir, r)));
const held = (round: string, name: string) => {
  const f = join(dir, round, name, "held.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) as { gpuMsPerFrame: number; medianMs: number; frames: number; drawnAt: unknown } : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const rows = FEATURES.map((f) => {
  const per = rounds.map((r) => {
    const on = held(r, `origin-${f.at}-base`), off = held(r, `origin-${f.at}-${f.key}`);
    return on && off ? { round: r, gpuMs: r2(on.gpuMsPerFrame - off.gpuMsPerFrame), frameMs: r2(on.medianMs - off.medianMs), base: { gpu: r2(on.gpuMsPerFrame), frame: r2(on.medianMs) } } : null;
  }).filter((x) => x !== null);
  const mean = (k: "gpuMs" | "frameMs") => (per.length ? r2(per.reduce((n, p) => n + p![k], 0) / per.length) : null);
  return { ...f, threeLines: f.lines ? lines[f.lines] ?? 0 : null, cost: { gpuMs: mean("gpuMs"), frameMs: mean("frameMs"), rounds: per } };
});

// --- the crops ------------------------------------------------------------------
mkdirSync(join(dir, "crops"), { recursive: true });
for (const f of FEATURES) {
  const o = join(dir, "r1", `origin-${f.at}-base`, "held.png"), t = join(dir, "r1", `three-${f.at}`, "held.png");
  if (!existsSync(o) || !existsSync(t)) continue;
  const [x, y, w, h] = f.crop, g = `${w}x${h}+${x}+${y}`;
  execFileSync("magick", [
    "(", o, "-crop", g, "+repage", "-gravity", "north", "-splice", "0x36", "-pointsize", "26", "-annotate", "+0+4", `Origin, ${f.at} s`, ")",
    "(", t, "-crop", g, "+repage", "-gravity", "north", "-splice", "0x36", "-pointsize", "26", "-annotate", "+0+4", `three.js, ${f.at} s`, ")",
    "+append", join(dir, "crops", `${f.key}.png`),
  ]);
}

// --- features.md ------------------------------------------------------------------
const cell = (n: number | null) => (n === null ? "n/a" : n.toFixed(2));
const md = [
  "| Feature | Path time | Origin draws | three.js | How three.js got there | Hand-written lines | Origin GPU ms/frame | Origin frame ms |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.title} | ${r.at} s | ${r.origin} | ${r.three} | ${r.how} | ${r.threeLines ?? "0"} | ${cell(r.cost.gpuMs)} | ${cell(r.cost.frameMs)} |`),
  "",
  ...rows.map((r) => `![${r.title}: Origin left, three.js right, ${r.at} s](crops/${r.key}.png)`),
  "",
  `Also hand-written in three.js, with no Origin switch to cost them: the layered terrain material and mesh (${lines.terrain ?? 0} lines), the height fog (${lines.fog ?? 0}), the wanderer's two-bone arm IK (${lines.ik ?? 0}).`,
];
writeFileSync(join(dir, "features.md"), md.join("\n") + "\n");
writeFileSync(join(dir, "features.json"), JSON.stringify({ rounds, lines, rows }, null, 2) + "\n");
console.log(md.slice(0, rows.length + 2).join("\n"));
