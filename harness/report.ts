// report.ts <results dir>: the summary of one set of runs (one per engine):
// summary.md with the table and the raw values it came from, and
// cover-side-by-side.png, the same frame (the path's last, the cover shot)
// from each engine.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) throw new Error("usage: report.ts <results dir>");
const NAMES: Record<string, string> = { origin: "Origin Engine 0.9.0", three: "three.js r187 WebGPURenderer" };
const disturbed = readdirSync(dir).filter((d) => d.includes("-disturbed-"));
const runs = readdirSync(dir).filter((d) => !d.includes("-disturbed-") && existsSync(join(dir, d, "run.json"))).map((d) => ({ dir: d, run: JSON.parse(readFileSync(join(dir, d, "run.json"), "utf8")) }));
const order = ["origin", "three"];
runs.sort((a, b) => order.indexOf(a.run.engine) - order.indexOf(b.run.engine));

const mb = (n: number) => (n / 1e6).toFixed(2);
const ms = (n: number) => n.toFixed(1);
const lines = [
  `# Night Shift in Chrome (WebGPU): ${runs[0]?.run.machine.date.slice(0, 10) ?? ""}`,
  "",
  `${runs[0]?.run.machine.model ?? ""}, ${runs[0]?.run.machine.cpu ?? ""}, macOS ${runs[0]?.run.machine.macos ?? ""}; ${runs[0]?.run.chrome.version ?? ""}; canvas ${runs[0]?.run.frameTime.resolution?.join(" x ") ?? ""}. One cold run per engine.`,
  "",
  "| Engine | Download (brotli) | Cold first frame | Frame time median | Frame time p95 | Frames on the path | Path wall time |",
  "|---|---|---|---|---|---|---|",
  ...runs.map(({ run }) => `| ${NAMES[run.engine] ?? run.engine} | ${mb(run.download.brotliBytes)} MB (${run.download.requests} requests) | ${Math.round(run.firstFrame.presentedMs)} ms | ${ms(run.frameTime.medianMs)} ms | ${ms(run.frameTime.p95Ms)} ms | ${run.frameTime.frames} | ${(run.frameTime.wallMs / 1000).toFixed(1)} s |`),
  "",
  "| Engine | First canvas frame (any content) | Page's first-frame mark | Frames drawn before the first full one | Mean frame time | Longest frame |",
  "|---|---|---|---|---|---|",
  ...runs.map(({ run }) => `| ${NAMES[run.engine] ?? run.engine} | ${Math.round(run.firstFrame.firstCanvasFrameMs)} ms | ${Math.round(run.firstFrame.markMs)} ms | ${run.firstFrame.framesBeforeIt} | ${ms(run.frameTime.meanMs)} ms | ${ms(run.frameTime.maxMs)} ms |`),
  "",
  "Load average (1, 5, 15 min) when each run started, and the highest one-minute load while it ran: " + runs.map(({ run }) => `${run.engine} ${run.machine.loadAverage}, at most ${run.machine.loadDuringRun.max}`).join("; ") + ".",
  disturbed.length ? `Runs repeated because other work disturbed them (kept beside these): ${disturbed.join(", ")}.` : "No run was disturbed.",
  "",
  "![The cover shot, the path's last frame, from each engine (left to right: " + runs.map(({ run }) => NAMES[run.engine] ?? run.engine).join(", ") + ")](cover-side-by-side.png)",
  "",
];
writeFileSync(join(dir, "summary.md"), lines.join("\n"));

const covers = runs.map(({ dir: d }) => join(dir, d, "cover.png")).filter(existsSync);
if (covers.length) {
  execFileSync("magick", [...covers.flatMap((c) => [c, "-resize", "1280x720"]), "+append", join(dir, "cover-side-by-side.png")]);
}
console.log(lines.join("\n"));
