// One measured run of one engine's page in Chrome (WebGPU), with a cold
// profile. Writes run.json (every raw value), requests.json (what the page
// downloaded), frames.json (every frame's timestamp and size) and the
// screenshots to --out.
//
//   bun harness/run.ts --engine origin|three --root <dir served> --out <dir>
//
// The page is served by harness/serve.ts (brotli-11, COOP/COEP). Chrome runs
// headed, driven over the DevTools protocol; harness/hook.js is injected
// into the page and into every Worker before their scripts run.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { PATH_SECONDS } from "../origin/night-shift/src/camera-path.ts";

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0) return process.argv[i + 1]!;
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
};
const engine = arg("engine");
const root = resolve(arg("root"));
const out = resolve(arg("out"));
const port = Number(arg("port", "8787"));
const cdpPort = Number(arg("cdp-port", "9333"));
/** --warmup: load the page to its first frame and stop, writing nothing (see run-all.sh). */
const warmup = process.argv.includes("--warmup");

/**
 * What differs per engine: how the camera path is started, the page's mark
 * for its first full frame, and the path's clock (seconds into the path, in
 * the engine's own simulation time).
 */
const ENGINES: Record<string, { start: "gate" | "call"; firstMark: string; clock: string }> = {
  // The publish shell's play gate starts the simulation; og:first-frame is
  // the engine's first frame with its pipelines made (the splash lifts); the
  // path runs on the fixed 60 Hz tick (src/main.ts CameraPath).
  origin: { start: "gate", firstMark: "og:first-frame", clock: "globalThis.__runtime_probe__.tick().then((r) => (typeof r === 'number' ? r : r.tick) / 60)" },
  // three/src/main.ts: window.__benchStart() starts the path on the
  // renderer's clock; bench:first-frame is marked after the first render.
  three: { start: "call", firstMark: "bench:first-frame", clock: "window.__benchPathSeconds()" },
};
const profile_ = ENGINES[engine];
if (!profile_) throw new Error(`--engine is one of ${Object.keys(ENGINES).join(", ")}`);

export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** The page's size in CSS pixels and its device pixel ratio: the canvas is drawn at 2560 x 1440. */
export const VIEW = { width: 1280, height: 720, dpr: 2 };
/** Seconds to let the page settle after its first frame before the path starts. */
const SETTLE = 5;

mkdirSync(out, { recursive: true });
const say = (m: string) => console.error(`run ${engine}: ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.timeOrigin + performance.now();
const HOOK = readFileSync(join(import.meta.dir, "hook.js"), "utf8");

// --- the machine before the run -------------------------------------------
const sh = (c: string) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return ""; } };
const machine = {
  date: new Date().toISOString(),
  host: sh("scutil --get ComputerName") || sh("hostname"),
  model: sh("sysctl -n hw.model"),
  cpu: sh("sysctl -n machdep.cpu.brand_string"),
  memoryBytes: Number(sh("sysctl -n hw.memsize")),
  macos: sh("sw_vers -productVersion") + " " + sh("sw_vers -buildVersion"),
  power: sh("pmset -g batt | head -1"),
  loadAverage: sh("sysctl -n vm.loadavg"),
  topProcesses: sh("ps -Ao pcpu,comm -r | head -8").split("\n"),
  waitedForQuietMs: 0,
};

// --- the server -------------------------------------------------------------
const server = Bun.spawn(["bun", join(import.meta.dir, "serve.ts"), root, "--port", String(port)], { stderr: "pipe", stdout: "inherit" });
{
  const reader = server.stderr.getReader();
  let text = "";
  while (!text.includes("http://")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the server stopped: ${text}`);
    text += new TextDecoder().decode(value);
  }
}
const base = `http://127.0.0.1:${port}`;
say(`serving ${root} at ${base}`);
await fetch(`${base}/__reset`);

// --- a quiet machine ---------------------------------------------------------
// The run waits until the one-minute load average has been under QUIET_LOAD
// (default 5) for a minute, so other work on the machine (builds, other
// agents) does not run alongside it; it records what it saw. The default
// leaves room for the processes that stayed busy on the benchmark Mac for
// days (about 2.5 cores of 12; README, Method).
const QUIET_LOAD = warmup ? Infinity : Number(process.env.QUIET_LOAD ?? 5);
const load1 = () => Number(sh("sysctl -n vm.loadavg").replace(/[{}]/g, "").trim().split(/\s+/)[0]);
// The load average does not see another program drawing on the GPU (a native
// game, a Safari test), so the GPU's own utilization (IOAccelerator "Device
// Utilization %") must also stay under QUIET_GPU (default 10) for that minute.
const QUIET_GPU = warmup ? Infinity : Number(process.env.QUIET_GPU ?? 10);
// GPU time per process (AGX user clients' accumulatedGPUTime, ns), so run.json
// shows who else drew on the GPU during the run.
const gpuTimes = () => {
  const out: Record<string, number> = {};
  let who = "";
  for (const line of sh("ioreg -l -w0 -c AGXDeviceUserClient | grep -E 'IOUserClientCreator|accumulatedGPUTime'").split("\n")) {
    const c = line.match(/"IOUserClientCreator" = "pid (\d+), ([^"]*)"/);
    if (c) who = `${c[2]} (${c[1]})`;
    const t = line.match(/"accumulatedGPUTime"=(\d+)/);
    if (t && who) out[who] = (out[who] ?? 0) + Number(t[1]);
  }
  return out;
};
const gpuShare = (a: Record<string, number>, b: Record<string, number>, ms: number) =>
  Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(((v - (a[k] ?? 0)) / 1e6 / ms) * 1000) / 1000]).filter(([, v]) => (v as number) >= 0.01).sort((x, y) => (y[1] as number) - (x[1] as number)));
const gpu = () => Math.max(0, ...[...sh("ioreg -r -c IOAccelerator -d 1").matchAll(/"Device Utilization %"=(\d+)/g)].map((m) => Number(m[1])));
{
  const began = now();
  let quietSince = 0;
  while (true) {
    const l = load1();
    const g = gpu();
    if (l < QUIET_LOAD && g < QUIET_GPU) { quietSince ||= now(); if (now() - quietSince >= (warmup ? 0 : 60_000)) break; } else quietSince = 0;
    if (now() - began > 6 * 3600_000) throw new Error(`the machine was not quiet (load ${l}) for six hours`);
    if (Math.round((now() - began) / 1000) % 120 === 0) say(`waiting for a quiet machine: load ${l}, GPU ${g}%, ${sh("ps -Ao pcpu,comm -r | sed -n 2,4p | tr -s ' ' | tr '\\n' ';'")}`);
    await sleep(1000);
  }
  machine.waitedForQuietMs = now() - began;
  machine.loadAverage = sh("sysctl -n vm.loadavg");
  machine.gpuUtilizationBefore = gpu();
  const t0 = now(), g0 = gpuTimes();
  await sleep(5000);
  machine.gpuShareBefore = gpuShare(g0, gpuTimes(), now() - t0);
  machine.topProcesses = sh("ps -Ao pcpu,comm -r | head -8").split("\n");
}

// The one-minute load average every second while Chrome runs, kept in
// run.json, so a run disturbed by other work shows it.
const loadSamples: [number, number][] = [];
const gpuRun0 = gpuTimes(), gpuRunAt = now();
const sampler = setInterval(() => loadSamples.push([Math.round(now()), load1()]), 1000);

// --- Chrome, with a profile of its own ---------------------------------------
const profile = mkdtempSync(join(tmpdir(), "engine-bench-profile-"));
const flags = [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-component-update",
  "--disable-background-networking", "--disable-sync", "--disable-default-apps", "--disable-features=Translate,MediaRouter,OptimizationHints",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  `--window-size=${VIEW.width},${VIEW.height + 200}`, "--window-position=0,0",
  "about:blank",
];
const chrome = Bun.spawn([CHROME, ...flags], { stdout: "ignore", stderr: "ignore" });
// Whatever ends the run, Chrome and the server end with it.
const cleanup = () => { chrome.kill(); server.kill(); };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { cleanup(); process.exit(1); });
let wsUrl = "";
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(100);
  try { wsUrl = ((await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl; } catch { /* not up yet */ }
}
if (!wsUrl) throw new Error("Chrome did not open its DevTools port");
const version = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()) as Record<string, string>;

// --- a minimal DevTools protocol client --------------------------------------
type Msg = { id?: number; method?: string; params?: any; result?: any; error?: any; sessionId?: string };
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const waiting = new Map<number, (m: Msg) => void>();
const listeners: ((m: Msg) => void)[] = [];
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data)) as Msg;
  if (m.id !== undefined) { waiting.get(m.id)?.(m); waiting.delete(m.id); return; }
  for (const l of listeners) l(m);
};
function send(method: string, params: object = {}, sessionId?: string): Promise<any> {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ok, fail) => waiting.set(id, (m) => (m.error ? fail(new Error(`${method}: ${JSON.stringify(m.error)}`)) : ok(m.result))));
}

// Every Worker (and a Worker's Workers) gets the hook before its first line.
const workers = new Map<string, { url: string; type: string }>();
listeners.push((m) => {
  if (m.method !== "Target.attachedToTarget") return;
  const { sessionId, targetInfo, waitingForDebugger } = m.params;
  if (targetInfo.type === "worker" || targetInfo.type === "shared_worker" || targetInfo.type === "service_worker") {
    workers.set(sessionId, { url: targetInfo.url, type: targetInfo.type });
    void (async () => {
      try {
        await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
        await send("Runtime.enable", {}, sessionId);
        const r = await send("Runtime.evaluate", { expression: `${HOOK}; typeof GPUCanvasContext + " " + !!globalThis.__bench` }, sessionId);
        if (process.env.BENCH_VERBOSE) say(`hook in ${targetInfo.url}: ${r.result?.value ?? JSON.stringify(r.exceptionDetails)}`);
      } finally {
        if (waitingForDebugger) await send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
      }
    })();
  } else if (waitingForDebugger) void send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
});

say(`Chrome ${version.Browser}`);
const { targetInfos } = await send("Target.getTargets");
const tab = targetInfos.find((t: any) => t.type === "page");
const { sessionId: page } = await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
await send("Page.enable", {}, page);
await send("Runtime.enable", {}, page);
await send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.dpr, mobile: false }, page);
await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK }, page);
await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, page);

const console_: string[] = [];
/** The session of the context that drew the first frame. */
let drawing = "";
listeners.push((m) => {
  if (m.method === "Runtime.consoleAPICalled" && m.params.args[0]?.value === "__bench:first-done" && !drawing) drawing = m.sessionId ?? page;
  if (m.method === "Runtime.consoleAPICalled" && m.params.type !== "debug") {
    const line = `${m.sessionId === page ? "page" : "worker"} ${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 500);
    console_.push(line);
    if (process.env.BENCH_VERBOSE) say(line);
  }
  if (m.method === "Runtime.exceptionThrown") console_.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 800)}`);
});

const evaluate = async (expression: string, sessionId = page): Promise<any> => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  return r.result.value;
};
/** The hook's record in the context that draws (thread-pool Workers parked in Atomics.wait never answer, so only that one is asked). */
async function record(sid: string): Promise<{ frames: [number, number, number][]; firstAcquire: number; firstDone: number }> {
  return JSON.parse(await evaluate("JSON.stringify(globalThis.__bench)", sid));
}
async function screenshot(name: string): Promise<void> {
  const { data } = await send("Page.captureScreenshot", { format: "png" }, page);
  writeFileSync(join(out, name), Buffer.from(data, "base64"));
}

// --- the run -----------------------------------------------------------------
const url = `${base}/`;
say("navigating");
const navigatedAt = now();
await send("Page.navigate", { url }, page);
const timeOrigin: number = await (async () => {
  for (let i = 0; i < 200; i++) {
    try { const t = await evaluate("location.href.startsWith('http') ? performance.timeOrigin : 0"); if (t) return t; } catch { /* navigating */ }
    await sleep(25);
  }
  throw new Error("the page did not load");
})();
const marks = async (): Promise<[string, number][]> => JSON.parse(await evaluate("JSON.stringify(performance.getEntriesByType('mark').map(m => [m.name, m.startTime]))"));

// The first full frame: the page marks it (the engine's own signal); the
// frame is the last one the drawing context took before the mark, and its
// time is when the GPU finished it.
const deadline = now() + 300_000;
let fullMark: number | undefined;
while (now() < deadline && !(drawing && fullMark !== undefined)) {
  await sleep(20);
  fullMark = (await marks().catch(() => [] as [string, number][])).find(([n]) => n === profile_.firstMark)?.[1];
}
if (!drawing || fullMark === undefined) throw new Error(`no first frame in 300 s; console:\n${console_.join("\n")}`);
await sleep(300); // the GPU finishes the marked frame
if (warmup) {
  say("warm-up: first frame drawn");
  ws.close();
  cleanup();
  await chrome.exited;
  rmSync(profile, { recursive: true, force: true });
  process.exit(0);
}
await screenshot("first-frame.png");
const boot = await record(drawing);
const fullAt = timeOrigin + fullMark;
const fullFrame = [...boot.frames].reverse().find(([t]) => t <= fullAt) ?? boot.frames[0]!;
const firstFrame = {
  timeOrigin,
  navigatedAt,
  /** The first frame drawn to the canvas at all, GPU-finished. */
  firstCanvasFrameMs: boot.frames[0]![3] - timeOrigin,
  /** The page's mark for its first full frame. */
  markMs: fullMark,
  /** That frame, GPU-finished: the cold first frame reported. */
  presentedMs: fullFrame[3] - timeOrigin,
  framesBeforeIt: boot.frames.indexOf(fullFrame),
  context: drawing === page ? "page" : workers.get(drawing)!.url,
};
say(`first frame presented at ${Math.round(firstFrame.presentedMs)} ms (first canvas frame ${Math.round(firstFrame.firstCanvasFrameMs)} ms)`);
const adapter = await evaluate("navigator.gpu.requestAdapter().then(a => a ? JSON.stringify({ vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description }) : 'null')").then(JSON.parse);

await sleep(SETTLE * 1000);
await evaluate("globalThis.__bench.trackDone = false", drawing);
const servedBeforePath = ((await (await fetch(`${base}/__log`)).json()) as unknown[]).length;

// The path: from the engine's clock 0 to PATH_SECONDS on it.
say("starting the path");
const pathAt = now();
if (profile_.start === "gate") {
  const box = await evaluate("(() => { const b = document.querySelector('#og-gate button'); if (!b || document.querySelector('#og-gate').hidden) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  if (!box) throw new Error("no play gate to press");
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 }, page);
} else {
  await evaluate("window.__benchStart()");
}
let pathEnd = 0;
while (now() - pathAt < 600_000) {
  const t = Number(await evaluate(profile_.clock));
  if (t >= PATH_SECONDS) { pathEnd = now(); break; }
  await sleep(10);
}
if (!pathEnd) throw new Error("the path did not end in 600 s");
say(`path done in ${Math.round(pathEnd - pathAt)} ms of wall time`);
await sleep(1500);
// The path ends where it began: the cover shot, the same frame for every engine.
await screenshot("cover.png");

const drawn = await record(drawing);
const frames = drawn.frames.filter(([t]) => t >= pathAt && t <= pathEnd);
const intervals = frames.slice(1).map(([t], i) => t - frames[i]![0]);
const sorted = [...intervals].sort((a, b) => a - b);
const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

clearInterval(sampler);
const served = (await (await fetch(`${base}/__log`)).json()) as { path: string; status: number; raw: number; sent: number; encoding: string }[];
const ok = served.filter((s) => s.status === 200);
const run = {
  engine,
  url,
  root,
  machine: { ...machine, loadDuringRun: { max: Math.max(...loadSamples.map(([, l]) => l)), samples: loadSamples }, gpuShareDuringRun: gpuShare(gpuRun0, gpuTimes(), now() - gpuRunAt) },
  chrome: { binary: CHROME, version: version.Browser, userAgent: version["User-Agent"], flags: flags.filter((f) => !f.startsWith("--user-data-dir") && !f.startsWith("--remote-debugging")) },
  adapter,
  view: VIEW,
  download: {
    brotliBytes: ok.reduce((n, s) => n + s.sent, 0),
    rawBytes: ok.reduce((n, s) => n + s.raw, 0),
    requests: served.length,
    requestsBeforePath: servedBeforePath,
    notBrotli: ok.filter((s) => s.encoding !== "br").map((s) => s.path),
    notFound: served.filter((s) => s.status !== 200).map((s) => s.path),
  },
  firstFrame,
  pageMarks: await marks(),
  frameTime: {
    pathSeconds: PATH_SECONDS,
    wallMs: pathEnd - pathAt,
    frames: frames.length,
    medianMs: q(0.5),
    p95Ms: q(0.95),
    meanMs: intervals.reduce((a, b) => a + b, 0) / intervals.length,
    maxMs: sorted[sorted.length - 1],
    resolution: frames.length ? [frames[0]![1], frames[0]![2]] : null,
  },
  workers: [...workers.values()].map((w) => w.url),
  console: console_,
};
writeFileSync(join(out, "run.json"), JSON.stringify(run, null, 2) + "\n");
writeFileSync(join(out, "requests.json"), JSON.stringify(served, null, 2) + "\n");
writeFileSync(join(out, "frames.json"), JSON.stringify({ pathAt, pathEnd, columns: ["acquired", "width", "height", "gpuDone"], frames: drawn.frames }) + "\n");
console.log(JSON.stringify({ engine, brotliBytes: run.download.brotliBytes, firstFrameMs: Math.round(firstFrame.presentedMs), medianMs: run.frameTime.medianMs, p95Ms: run.frameTime.p95Ms, frames: frames.length, resolution: run.frameTime.resolution }));

ws.close();
cleanup();
await chrome.exited;
rmSync(profile, { recursive: true, force: true });
// Another program that drew on the GPU during the run, beyond what it drew
// before it (gpuShareBefore), by more than DISTURBED_GPU seconds of GPU time
// per second (default 0.1), disturbed the run. WeChat's XPlayer helper draws
// a steady, low idle load on this Mac (observed 0.4-0.8 s/s) that tracks
// window/compositor activity, not GPU contention from this benchmark; it is
// excluded by name here and documented in the README rather than silencing
// the check generally.
const DISTURBED_GPU = Number(process.env.DISTURBED_GPU ?? 0.1);
const IGNORE_GPU = /Chrome|WindowServer|XPlayer/;
const before = machine.gpuShareBefore as Record<string, number>;
const intruders = Object.entries(run.machine.gpuShareDuringRun as Record<string, number>)
  .filter(([k, v]) => !IGNORE_GPU.test(k) && v - (before[k.replace(/ \(\d+\)$/, "")] ?? before[k] ?? 0) > DISTURBED_GPU);
if (intruders.length) {
  say(`disturbed: other GPU work during the run: ${intruders.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  process.exit(3);
}
// A run during which the load average went past DISTURBED_LOAD (default
// twice the quiet threshold) was disturbed: exit 3 (run-all.sh repeats it,
// keeping this one's files).
const DISTURBED_LOAD = Number(process.env.DISTURBED_LOAD ?? QUIET_LOAD * 2);
if (run.machine.loadDuringRun.max > DISTURBED_LOAD) {
  say(`disturbed: the load average reached ${run.machine.loadDuringRun.max} (over ${DISTURBED_LOAD})`);
  process.exit(3);
}
process.exit(0);
