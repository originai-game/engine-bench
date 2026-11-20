// video.ts <dir> [--title <text>]: the side-by-side videos from two --video
// runs, <dir>/origin and <dir>/three (scripts/video.sh). Each engine's pane
// is the frames Chrome presented during that engine's own pass of the camera
// path, each engine alone on the GPU, at 30 fps, with that pass's frame time
// (the median interval over the last second of its frames, frames.json), the
// render scale automatic quality drew at (Origin), and where on the path and
// on the wall clock the pane is.
//
// - side-by-side.mp4, on the path's clock: at path time t each pane shows the
//   frame its engine had presented when its own clock reached t, so the two
//   show the same view throughout. An engine whose frames take longer than
//   its simulation catches up (Origin: maxCatchUpTicks 4 at 60 Hz, so past
//   66.7 ms a frame) took longer than 20 s of wall time for the path; its
//   pane shows fewer distinct frames per second, as many as it drew.
// - side-by-side-realtime.mp4, on the wall clock: what a player saw, each
//   pane from its pass's start; the pane that finished first holds its last
//   frame.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2] ? resolve(process.argv[2]) : "";
if (!dir) throw new Error("usage: video.ts <dir> [--title <text>]");
const titleAt = process.argv.indexOf("--title");
const title = titleAt > 0 ? process.argv[titleAt + 1]! : "";
const PANE = { width: 1920, height: 1080 }, FPS = 30, PATH = 20;
const NAMES: Record<string, string> = { origin: "Origin Engine", three: "three.js r187 (WebGPURenderer)" };
const ass = (s: number) => `0:${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;

type Mode = "path" | "realtime";
function pane(engine: string, mode: Mode): { file: string; length: number } {
  const run = join(dir, engine);
  const v = JSON.parse(readFileSync(join(run, "video.json"), "utf8")) as {
    pathAt: number; pathEnd: number; shots: [number, string][]; pathClock: [number, number][];
  };
  const f = JSON.parse(readFileSync(join(run, "frames.json"), "utf8")) as { frames: number[][]; display: { rows: number[][] } | null };
  const clock = v.pathClock;
  /** The wall time the engine's path clock reached `s`. */
  const wallAt = (s: number) => {
    const i = clock.findIndex(([, t]) => t >= s);
    if (i <= 0) return i === 0 ? clock[0]![0] : v.pathEnd;
    const [w0, t0] = clock[i - 1]!, [w1, t1] = clock[i]!;
    return w0 + ((s - t0) / Math.max(1e-6, t1 - t0)) * (w1 - w0);
  };
  const pathAtWall = (w: number) => [...clock].reverse().find(([cw]) => cw <= w)?.[1] ?? 0;
  const shotAt = (w: number) => ([...v.shots].reverse().find(([t]) => t <= w) ?? v.shots[0]!)[1];
  const acquired = f.frames.map((r) => r[0]!);
  const frameMsAt = (w: number) => {
    const win = acquired.filter((t) => t > w - 1000 && t <= w);
    const gaps = win.slice(1).map((t, i) => t - win[i]!).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)]! : NaN;
  };
  const rows = f.display?.rows;
  const scaleAt = (w: number) => (rows?.length ? [...rows].reverse().find((r) => r[0]! <= w) ?? rows[0]! : null);

  const length = mode === "path" ? PATH : (v.pathEnd - v.pathAt) / 1000;
  const wallOf = (o: number) => (mode === "path" ? wallAt(o) : v.pathAt + o * 1000);
  // The frames: one entry per run of output frames showing the same capture.
  const n = Math.round(length * FPS), list: string[] = [];
  let last = "", count = 0;
  const flush = () => { if (count) list.push(`file '${join(run, "video", last)}'\nduration ${(count / FPS).toFixed(5)}`); };
  for (let k = 0; k < n; k++) {
    const shot = shotAt(wallOf(k / FPS));
    if (shot === last) { count++; continue; }
    flush(); last = shot; count = 1;
  }
  flush();
  list.push(`file '${join(run, "video", last)}'`);
  writeFileSync(join(run, `video-${mode}.list`), list.join("\n") + "\n");

  const events: string[] = [];
  for (let o = 0; o < length; o += 0.25) {
    const w = wallOf(o), ms = frameMsAt(w), r = scaleAt(w);
    let text = `${NAMES[engine]}\\N${Number.isFinite(ms) ? `${ms.toFixed(1)} ms per frame (${(1000 / ms).toFixed(0)} fps)` : "first frames"}`;
    if (r) text += `\\Nrender scale ${r[2]!.toFixed(2)} (${r[4]}x${r[5]})`;
    text += `\\Npath ${Math.min(PATH, pathAtWall(w)).toFixed(1)} s, wall ${((w - v.pathAt) / 1000).toFixed(1)} s`;
    events.push(`Dialogue: 0,${ass(o)},${ass(Math.min(length, o + 0.25))},Box,,0,0,0,,${text}`);
  }
  writeFileSync(join(run, `overlay-${mode}.ass`), [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${PANE.width}`, `PlayResY: ${PANE.height}`, "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Box,Helvetica,32,&H00FFFFFF,&H00FFFFFF,&H90000000,&H90000000,0,0,0,0,100,100,0,0,3,10,0,7,24,24,20,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...events,
  ].join("\n") + "\n");

  const file = join(run, `pane-${mode}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(run, `video-${mode}.list`),
    "-vf", `scale=${PANE.width}:${PANE.height}:flags=lanczos,fps=${FPS},ass=${join(run, `overlay-${mode}.ass`)}`,
    "-t", length.toFixed(3), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "slow", file]);
  return { file, length };
}

for (const mode of ["path", "realtime"] as const) {
  const panes = ["origin", "three"].map((e) => pane(e, mode));
  const longest = Math.max(...panes.map((p) => p.length));
  const hold = (i: number) => `[${i}:v]tpad=stop_mode=clone:stop_duration=${(longest - panes[i]!.length + 0.05).toFixed(3)}[p${i}]`;
  // drawtext's text, escaped for a filtergraph: no quotes or colons, commas escaped.
  const label = `${title}${title ? ", " : ""}${mode === "path" ? "both panes on the path clock" : "both panes on the wall clock"}`.replace(/[':]/g, "").replace(/,/g, "\\,");
  const caption = `,drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='${label}':fontsize=28:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10:x=(w-tw)/2:y=h-th-24`;
  const out = join(dir, mode === "path" ? "side-by-side.mp4" : "side-by-side-realtime.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", panes[0]!.file, "-i", panes[1]!.file,
    "-filter_complex", `${hold(0)};${hold(1)};[p0][p1]hstack=inputs=2${caption}[v]`, "-map", "[v]", "-t", longest.toFixed(3),
    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-movflags", "+faststart", out]);
  console.log(out);
}
